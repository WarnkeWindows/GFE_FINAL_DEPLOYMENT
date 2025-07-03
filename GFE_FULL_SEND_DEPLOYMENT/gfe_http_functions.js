/**
 * ========================================================================
 * GOOD FAITH EXTERIORS - BACKEND HTTP FUNCTIONS
 * ========================================================================
 * Main API endpoints for GFE system
 * File: backend/http-functions.js
 */

import { ok, badRequest, serverError, forbidden } from 'wix-http-functions';
import wixData from 'wix-data';
import wixCrm from 'wix-crm-backend';
import wixSecrets from 'wix-secrets-backend';
import { fetch } from 'wix-fetch';

const BACKEND_URL = "https://gfe-backend-837326026335.us-central1.run.app";

// ========================================================================
// LEAD MANAGEMENT ENDPOINTS
// ========================================================================

/**
 * Create new lead
 * POST /api/leads
 */
export async function post_leads(request) {
    try {
        const leadData = await request.body.json();
        console.log('Received lead data:', leadData);
        
        // Validate required fields
        const validation = validateLeadData(leadData);
        if (!validation.isValid) {
            return badRequest({
                error: 'Validation failed',
                details: validation.errors
            });
        }
        
        // Process lead data
        const processedLead = await processLeadData(leadData);
        
        // Save to CRM collection
        const savedLead = await wixData.save('GFE_Leads', processedLead);
        
        // Create CRM contact
        try {
            await wixCrm.createContact({
                name: {
                    first: leadData.fullName.split(' ')[0],
                    last: leadData.fullName.split(' ').slice(1).join(' ') || ''
                },
                emails: [leadData.email],
                phones: leadData.phone ? [leadData.phone] : [],
                labels: ['GFE Lead', leadData.projectType || 'General']
            });
        } catch (crmError) {
            console.log('CRM contact creation failed (may already exist):', crmError);
        }
        
        // Send notifications
        await sendLeadNotifications(savedLead);
        
        return ok({
            success: true,
            leadId: savedLead._id,
            message: 'Lead captured successfully'
        });
        
    } catch (error) {
        console.error('Lead creation error:', error);
        return serverError({
            error: 'Failed to create lead',
            message: error.message
        });
    }
}

/**
 * Get leads with filtering
 * GET /api/leads
 */
export async function get_leads(request) {
    try {
        const { query } = request;
        const page = parseInt(query.page) || 1;
        const limit = Math.min(parseInt(query.limit) || 50, 100);
        const status = query.status;
        const source = query.source;
        
        let queryBuilder = wixData.query('GFE_Leads')
            .limit(limit)
            .skip((page - 1) * limit)
            .descending('_createdDate');
        
        if (status) {
            queryBuilder = queryBuilder.eq('status', status);
        }
        
        if (source) {
            queryBuilder = queryBuilder.eq('source', source);
        }
        
        const results = await queryBuilder.find();
        
        return ok({
            leads: results.items,
            totalCount: results.totalCount,
            page: page,
            hasMore: results.hasNext()
        });
        
    } catch (error) {
        console.error('Get leads error:', error);
        return serverError({
            error: 'Failed to retrieve leads'
        });
    }
}

// ========================================================================
// QUOTE MANAGEMENT ENDPOINTS
// ========================================================================

/**
 * Create new quote
 * POST /api/quotes
 */
export async function post_quotes(request) {
    try {
        const quoteData = await request.body.json();
        console.log('Received quote data:', quoteData);
        
        // Validate quote data
        const validation = validateQuoteData(quoteData);
        if (!validation.isValid) {
            return badRequest({
                error: 'Validation failed',
                details: validation.errors
            });
        }
        
        // Process quote
        const processedQuote = await processQuoteData(quoteData);
        
        // Save to collection
        const savedQuote = await wixData.save('GFE_Quotes', processedQuote);
        
        // Generate PDF (async)
        generateQuotePDF(savedQuote).catch(error => {
            console.error('PDF generation failed:', error);
        });
        
        return ok({
            success: true,
            quoteId: savedQuote.quoteId,
            totalAmount: savedQuote.totalAmount,
            validUntil: savedQuote.validUntil,
            message: 'Quote created successfully'
        });
        
    } catch (error) {
        console.error('Quote creation error:', error);
        return serverError({
            error: 'Failed to create quote',
            message: error.message
        });
    }
}

/**
 * Get quote by ID
 * GET /api/quotes/{quoteId}
 */
export async function get_quotes(request) {
    try {
        const quoteId = request.path[0];
        
        if (!quoteId) {
            return badRequest({ error: 'Quote ID is required' });
        }
        
        const quote = await wixData.query('GFE_Quotes')
            .eq('quoteId', quoteId)
            .find();
        
        if (quote.items.length === 0) {
            return badRequest({ error: 'Quote not found' });
        }
        
        return ok(quote.items[0]);
        
    } catch (error) {
        console.error('Get quote error:', error);
        return serverError({
            error: 'Failed to retrieve quote'
        });
    }
}

// ========================================================================
// PRODUCT MANAGEMENT ENDPOINTS
// ========================================================================

/**
 * Get window products with filtering
 * GET /api/products
 */
export async function get_products(request) {
    try {
        const { query } = request;
        const brand = query.brand;
        const windowType = query.windowType;
        const material = query.material;
        const priceMin = query.priceMin ? parseFloat(query.priceMin) : null;
        const priceMax = query.priceMax ? parseFloat(query.priceMax) : null;
        
        let queryBuilder = wixData.query('GFE_WindowProducts')
            .limit(100);
        
        // Apply filters
        if (brand && brand !== 'All') {
            queryBuilder = queryBuilder.eq('brand', brand);
        }
        
        if (windowType && windowType !== 'All') {
            queryBuilder = queryBuilder.eq('windowType', windowType);
        }
        
        if (material && material !== 'All') {
            queryBuilder = queryBuilder.eq('material', material);
        }
        
        if (priceMin !== null) {
            queryBuilder = queryBuilder.ge('basePrice', priceMin);
        }
        
        if (priceMax !== null) {
            queryBuilder = queryBuilder.le('basePrice', priceMax);
        }
        
        const results = await queryBuilder.find();
        
        return ok({
            products: results.items,
            totalCount: results.totalCount,
            filters: await getProductFilters()
        });
        
    } catch (error) {
        console.error('Get products error:', error);
        return serverError({
            error: 'Failed to retrieve products'
        });
    }
}

// ========================================================================
// AI ESTIMATION ENDPOINTS
// ========================================================================

/**
 * AI window estimation from photo
 * POST /api/ai/estimate
 */
export async function post_ai_estimate(request) {
    try {
        const estimateData = await request.body.json();
        console.log('AI estimate request received');
        
        // Validate image data
        if (!estimateData.imageData && !estimateData.imageUrl) {
            return badRequest({
                error: 'Image data or URL is required'
            });
        }
        
        // Call AI estimation service
        const estimationResult = await callAIEstimationService(estimateData);
        
        // Save estimation record
        const estimationRecord = {
            sessionId: estimateData.sessionId || generateSessionId(),
            customerEmail: estimateData.customerEmail,
            estimationData: estimationResult,
            createdDate: new Date(),
            source: 'ai_estimator'
        };
        
        await wixData.save('GFE_AIEstimations', estimationRecord);
        
        return ok({
            success: true,
            estimation: estimationResult
        });
        
    } catch (error) {
        console.error('AI estimation error:', error);
        return serverError({
            error: 'AI estimation failed',
            message: error.message
        });
    }
}

// ========================================================================
// CUSTOMER PORTAL ENDPOINTS
// ========================================================================

/**
 * Get customer projects
 * GET /api/customer/projects
 */
export async function get_customer_projects(request) {
    try {
        const customerEmail = request.query.customerEmail;
        
        if (!customerEmail) {
            return badRequest({ error: 'Customer email is required' });
        }
        
        const projects = await wixData.query('GFE_Projects')
            .eq('customerEmail', customerEmail)
            .descending('_createdDate')
            .find();
        
        return ok({
            projects: projects.items,
            totalCount: projects.totalCount
        });
        
    } catch (error) {
        console.error('Get customer projects error:', error);
        return serverError({
            error: 'Failed to retrieve projects'
        });
    }
}

/**
 * Schedule appointment
 * POST /api/appointments
 */
export async function post_appointments(request) {
    try {
        const appointmentData = await request.body.json();
        
        // Validate appointment data
        const validation = validateAppointmentData(appointmentData);
        if (!validation.isValid) {
            return badRequest({
                error: 'Validation failed',
                details: validation.errors
            });
        }
        
        // Process appointment
        const processedAppointment = {
            ...appointmentData,
            appointmentId: generateAppointmentId(),
            status: 'scheduled',
            createdDate: new Date()
        };
        
        // Save appointment
        const savedAppointment = await wixData.save('GFE_Appointments', processedAppointment);
        
        // Send confirmation emails
        await sendAppointmentConfirmation(savedAppointment);
        
        return ok({
            success: true,
            appointmentId: savedAppointment.appointmentId,
            message: 'Appointment scheduled successfully'
        });
        
    } catch (error) {
        console.error('Appointment scheduling error:', error);
        return serverError({
            error: 'Failed to schedule appointment'
        });
    }
}

// ========================================================================
// UTILITY FUNCTIONS
// ========================================================================

function validateLeadData(data) {
    const errors = [];
    
    if (!data.fullName || data.fullName.trim().length < 2) {
        errors.push('Full name must be at least 2 characters');
    }
    
    if (!data.email || !isValidEmail(data.email)) {
        errors.push('Valid email address is required');
    }
    
    if (data.phone && !isValidPhone(data.phone)) {
        errors.push('Valid phone number format required');
    }
    
    return {
        isValid: errors.length === 0,
        errors: errors
    };
}

function validateQuoteData(data) {
    const errors = [];
    
    if (!data.customerEmail || !isValidEmail(data.customerEmail)) {
        errors.push('Valid customer email is required');
    }
    
    if (!data.windowItems || !Array.isArray(data.windowItems) || data.windowItems.length === 0) {
        errors.push('At least one window item is required');
    }
    
    return {
        isValid: errors.length === 0,
        errors: errors
    };
}

function validateAppointmentData(data) {
    const errors = [];
    
    if (!data.customerName || data.customerName.trim().length < 2) {
        errors.push('Customer name is required');
    }
    
    if (!data.customerEmail || !isValidEmail(data.customerEmail)) {
        errors.push('Valid email address is required');
    }
    
    if (!data.preferredDate) {
        errors.push('Preferred appointment date is required');
    }
    
    if (!data.appointmentType) {
        errors.push('Appointment type is required');
    }
    
    return {
        isValid: errors.length === 0,
        errors: errors
    };
}

async function processLeadData(leadData) {
    // Calculate lead score
    let leadScore = 50; // Base score
    
    if (leadData.email) leadScore += 20;
    if (leadData.phone) leadScore += 20;
    if (leadData.projectType === 'Window Replacement') leadScore += 10;
    if (leadData.customerAddress) leadScore += 5;
    if (leadData.notes && leadData.notes.length > 20) leadScore += 5;
    
    // Determine priority
    let priority = 'low';
    if (leadScore >= 80) priority = 'high';
    else if (leadScore >= 60) priority = 'medium';
    
    return {
        fullName: leadData.fullName.trim(),
        email: leadData.email.toLowerCase().trim(),
        phone: cleanPhoneNumber(leadData.phone || ''),
        projectType: leadData.projectType || 'General Inquiry',
        customerAddress: leadData.customerAddress || '',
        notes: leadData.notes || '',
        source: leadData.source || 'Website',
        status: 'new',
        leadScore: leadScore,
        priority: priority,
        assignedTo: await assignToTeamMember(),
        followUpDate: calculateFollowUpDate(priority),
        createdDate: new Date(),
        lastUpdated: new Date()
    };
}

async function processQuoteData(quoteData) {
    const quoteId = generateQuoteId();
    
    // Calculate totals
    let subtotal = 0;
    const processedItems = quoteData.windowItems.map(item => {
        const itemTotal = (item.unitPrice || 0) * (item.quantity || 1);
        subtotal += itemTotal;
        return {
            ...item,
            totalPrice: itemTotal
        };
    });
    
    const tax = subtotal * 0.08; // 8% tax
    const totalAmount = subtotal + tax;
    
    // Set expiration date (30 days from now)
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + 30);
    
    return {
        quoteId: quoteId,
        customerName: quoteData.customerName,
        customerEmail: quoteData.customerEmail,
        customerPhone: quoteData.customerPhone || '',
        windowItems: processedItems,
        subtotal: subtotal,
        tax: tax,
        totalAmount: totalAmount,
        status: 'pending',
        validUntil: expirationDate,
        source: quoteData.source || 'Website',
        createdDate: new Date(),
        lastModified: new Date()
    };
}

async function callAIEstimationService(estimateData) {
    try {
        const response = await fetch(`${BACKEND_URL}/api/ai/analyze-image`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': await wixSecrets.getSecret('BACKEND_API_KEY')
            },
            body: JSON.stringify(estimateData)
        });
        
        if (!response.ok) {
            throw new Error(`AI service error: ${response.statusText}`);
        }
        
        return await response.json();
        
    } catch (error) {
        console.error('AI estimation service error:', error);
        
        // Fallback estimation
        return {
            windowCount: 8,
            windowTypes: {
                'double-hung': 6,
                'casement': 2
            },
            estimatedCost: {
                materials: 8500,
                labor: 3200,
                total: 11700
            },
            confidence: 0.75,
            notes: 'Fallback estimation used'
        };
    }
}

async function sendLeadNotifications(leadData) {
    try {
        // Send email to assigned team member
        await fetch(`${BACKEND_URL}/api/send-email`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': await wixSecrets.getSecret('BACKEND_API_KEY')
            },
            body: JSON.stringify({
                to: leadData.assignedTo || 'info@goodfaithexteriors.com',
                subject: `New Lead: ${leadData.fullName} - ${leadData.priority.toUpperCase()} Priority`,
                template: 'new_lead_notification',
                data: leadData
            })
        });
        
        console.log('Lead notification sent');
    } catch (error) {
        console.error('Lead notification error:', error);
    }
}

async function generateQuotePDF(quoteData) {
    try {
        const response = await fetch(`${BACKEND_URL}/api/generate-pdf`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': await wixSecrets.getSecret('BACKEND_API_KEY')
            },
            body: JSON.stringify({
                type: 'quote',
                data: quoteData
            })
        });
        
        if (response.ok) {
            const pdfResult = await response.json();
            
            // Update quote with PDF URL
            await wixData.update('GFE_Quotes', {
                _id: quoteData._id,
                pdfUrl: pdfResult.url
            });
            
            console.log('Quote PDF generated');
        }
    } catch (error) {
        console.error('PDF generation error:', error);
    }
}

async function sendAppointmentConfirmation(appointmentData) {
    try {
        await fetch(`${BACKEND_URL}/api/send-email`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': await wixSecrets.getSecret('BACKEND_API_KEY')
            },
            body: JSON.stringify({
                to: appointmentData.customerEmail,
                subject: 'Appointment Confirmation - Good Faith Exteriors',
                template: 'appointment_confirmation',
                data: appointmentData
            })
        });
        
        console.log('Appointment confirmation sent');
    } catch (error) {
        console.error('Appointment confirmation error:', error);
    }
}

async function getProductFilters() {
    try {
        const products = await wixData.query('GFE_WindowProducts')
            .limit(1000)
            .find();
        
        const brands = [...new Set(products.items.map(p => p.brand))].filter(Boolean);
        const windowTypes = [...new Set(products.items.map(p => p.windowType))].filter(Boolean);
        const materials = [...new Set(products.items.map(p => p.material))].filter(Boolean);
        
        const prices = products.items
            .map(p => p.basePrice)
            .filter(p => typeof p === 'number' && p > 0);
        
        return {
            brands: brands,
            windowTypes: windowTypes,
            materials: materials,
            priceRange: {
                min: prices.length > 0 ? Math.min(...prices) : 0,
                max: prices.length > 0 ? Math.max(...prices) : 5000
            }
        };
    } catch (error) {
        console.error('Error getting product filters:', error);
        return {
            brands: ['Andersen', 'Pella', 'Marvin'],
            windowTypes: ['Double-Hung', 'Casement', 'Sliding'],
            materials: ['Vinyl', 'Wood', 'Fiberglass'],
            priceRange: { min: 400, max: 3000 }
        };
    }
}

// Helper functions
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function isValidPhone(phone) {
    const phoneRegex = /^\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})$/;
    return phoneRegex.test(phone);
}

function cleanPhoneNumber(phone) {
    return phone.replace(/\D/g, '');
}

function generateQuoteId() {
    return 'GFE-Q-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4).toUpperCase();
}

function generateAppointmentId() {
    return 'GFE-A-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4).toUpperCase();
}

function generateSessionId() {
    return 'GFE-S-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6).toUpperCase();
}

async function assignToTeamMember() {
    const teamMembers = [
        'nick@goodfaithexteriors.com',
        'rich@goodfaithexteriors.com',
        'sales@goodfaithexteriors.com'
    ];
    return teamMembers[Math.floor(Math.random() * teamMembers.length)];
}

function calculateFollowUpDate(priority) {
    const now = new Date();
    switch (priority) {
        case 'high':
            return new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours
        case 'medium':
            return new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
        case 'low':
            return new Date(now.getTime() + 72 * 60 * 60 * 1000); // 72 hours
        default:
            return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    }
}