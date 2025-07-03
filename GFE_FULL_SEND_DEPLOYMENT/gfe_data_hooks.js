/**
 * ========================================================================
 * GOOD FAITH EXTERIORS - DATA HOOKS
 * ========================================================================
 * Collection event handlers and data validation
 * File: backend/data-hooks.js
 */

import wixData from 'wix-data';
import { fetch } from 'wix-fetch';
import wixSecrets from 'wix-secrets-backend';

const BACKEND_URL = "https://gfe-backend-837326026335.us-central1.run.app";

// ========================================================================
// GFE_LEADS COLLECTION HOOKS
// ========================================================================

export function GFE_Leads_beforeInsert(item, context) {
    console.log('GFE_Leads beforeInsert triggered');
    
    // Set timestamps
    item.createdDate = new Date();
    item.lastUpdated = new Date();
    
    // Set default status
    if (!item.status) {
        item.status = 'new';
    }
    
    // Clean and validate data
    if (item.email) {
        item.email = item.email.toLowerCase().trim();
    }
    
    if (item.phone) {
        item.phone = cleanPhoneNumber(item.phone);
    }
    
    // Calculate lead score if not provided
    if (!item.leadScore) {
        item.leadScore = calculateLeadScore(item);
    }
    
    // Set priority based on lead score
    if (!item.priority) {
        item.priority = determinePriority(item.leadScore);
    }
    
    // Generate follow-up date
    if (!item.followUpDate) {
        item.followUpDate = calculateFollowUpDate(item.priority);
    }
    
    return item;
}

export function GFE_Leads_afterInsert(item, context) {
    console.log('GFE_Leads afterInsert triggered for:', item._id);
    
    // Send notifications asynchronously
    sendLeadNotifications(item).catch(error => {
        console.error('Lead notification error:', error);
    });
    
    // Track analytics
    trackEvent('lead_created', {
        leadId: item._id,
        source: item.source,
        priority: item.priority,
        leadScore: item.leadScore
    }).catch(error => {
        console.error('Analytics tracking error:', error);
    });
    
    return item;
}

export function GFE_Leads_beforeUpdate(item, context) {
    console.log('GFE_Leads beforeUpdate triggered');
    
    // Update timestamp
    item.lastUpdated = new Date();
    
    // Recalculate lead score if data changed
    if (context.currentItem) {
        const fieldsToCheck = ['email', 'phone', 'projectType', 'customerAddress', 'notes'];
        const hasChanged = fieldsToCheck.some(field => 
            item[field] !== context.currentItem[field]
        );
        
        if (hasChanged) {
            item.leadScore = calculateLeadScore(item);
            item.priority = determinePriority(item.leadScore);
        }
    }
    
    return item;
}

export function GFE_Leads_afterUpdate(item, context) {
    console.log('GFE_Leads afterUpdate triggered for:', item._id);
    
    // Track status changes
    if (context.currentItem && item.status !== context.currentItem.status) {
        trackEvent('lead_status_changed', {
            leadId: item._id,
            oldStatus: context.currentItem.status,
            newStatus: item.status
        }).catch(error => {
            console.error('Analytics tracking error:', error);
        });
    }
    
    return item;
}

// ========================================================================
// GFE_QUOTES COLLECTION HOOKS
// ========================================================================

export function GFE_Quotes_beforeInsert(item, context) {
    console.log('GFE_Quotes beforeInsert triggered');
    
    // Set timestamps
    item.createdDate = new Date();
    item.lastModified = new Date();
    
    // Generate quote ID if not provided
    if (!item.quoteId) {
        item.quoteId = generateQuoteId();
    }
    
    // Set default status
    if (!item.status) {
        item.status = 'pending';
    }
    
    // Set expiration date if not provided (30 days from now)
    if (!item.validUntil) {
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + 30);
        item.validUntil = expirationDate;
    }
    
    // Calculate totals if window items provided
    if (item.windowItems && Array.isArray(item.windowItems)) {
        const totals = calculateQuoteTotals(item.windowItems);
        item.subtotal = totals.subtotal;
        item.tax = totals.tax;
        item.totalAmount = totals.total;
    }
    
    return item;
}

export function GFE_Quotes_afterInsert(item, context) {
    console.log('GFE_Quotes afterInsert triggered for:', item._id);
    
    // Generate PDF asynchronously
    generateQuotePDF(item).catch(error => {
        console.error('PDF generation error:', error);
    });
    
    // Send quote email
    sendQuoteEmail(item).catch(error => {
        console.error('Quote email error:', error);
    });
    
    // Track analytics
    trackEvent('quote_created', {
        quoteId: item.quoteId,
        totalAmount: item.totalAmount,
        customerEmail: item.customerEmail
    }).catch(error => {
        console.error('Analytics tracking error:', error);
    });
    
    return item;
}

export function GFE_Quotes_beforeUpdate(item, context) {
    console.log('GFE_Quotes beforeUpdate triggered');
    
    // Update timestamp
    item.lastModified = new Date();
    
    // Recalculate totals if window items changed
    if (item.windowItems && Array.isArray(item.windowItems)) {
        const totals = calculateQuoteTotals(item.windowItems);
        item.subtotal = totals.subtotal;
        item.tax = totals.tax;
        item.totalAmount = totals.total;
    }
    
    return item;
}

export function GFE_Quotes_afterUpdate(item, context) {
    console.log('GFE_Quotes afterUpdate triggered for:', item._id);
    
    // Track status changes
    if (context.currentItem && item.status !== context.currentItem.status) {
        trackEvent('quote_status_changed', {
            quoteId: item.quoteId,
            oldStatus: context.currentItem.status,
            newStatus: item.status
        }).catch(error => {
            console.error('Analytics tracking error:', error);
        });
        
        // Send status change notification
        if (item.status === 'accepted') {
            sendQuoteAcceptedNotification(item).catch(error => {
                console.error('Quote acceptance notification error:', error);
            });
        }
    }
    
    return item;
}

// ========================================================================
// GFE_WINDOWPRODUCTS COLLECTION HOOKS
// ========================================================================

export function GFE_WindowProducts_beforeInsert(item, context) {
    console.log('GFE_WindowProducts beforeInsert triggered');
    
    // Set timestamps
    item.createdDate = new Date();
    item.lastUpdated = new Date();
    
    // Set default values
    if (item.inStock === undefined) {
        item.inStock = true;
    }
    
    // Validate price
    if (item.basePrice && typeof item.basePrice === 'number' && item.basePrice > 0) {
        // Generate price range
        item.priceRange = generatePriceRange(item.basePrice);
    }
    
    return item;
}

export function GFE_WindowProducts_afterInsert(item, context) {
    console.log('GFE_WindowProducts afterInsert triggered for:', item._id);
    
    // Track new product
    trackEvent('product_added', {
        productId: item._id,
        brand: item.brand,
        windowType: item.windowType,
        basePrice: item.basePrice
    }).catch(error => {
        console.error('Analytics tracking error:', error);
    });
    
    return item;
}

export function GFE_WindowProducts_beforeUpdate(item, context) {
    console.log('GFE_WindowProducts beforeUpdate triggered');
    
    // Update timestamp
    item.lastUpdated = new Date();
    
    // Update price range if price changed
    if (item.basePrice && typeof item.basePrice === 'number' && item.basePrice > 0) {
        item.priceRange = generatePriceRange(item.basePrice);
    }
    
    return item;
}

// ========================================================================
// GFE_CUSTOMERS COLLECTION HOOKS
// ========================================================================

export function GFE_Customers_beforeInsert(item, context) {
    console.log('GFE_Customers beforeInsert triggered');
    
    // Set timestamps
    item.createdDate = new Date();
    item.lastActivity = new Date();
    
    // Clean email
    if (item.email) {
        item.email = item.email.toLowerCase().trim();
    }
    
    // Clean phone
    if (item.phone) {
        item.phone = cleanPhoneNumber(item.phone);
    }
    
    // Set default values
    if (!item.status) {
        item.status = 'active';
    }
    
    if (!item.totalProjects) {
        item.totalProjects = 0;
    }
    
    if (!item.totalSpent) {
        item.totalSpent = 0;
    }
    
    return item;
}

export function GFE_Customers_afterInsert(item, context) {
    console.log('GFE_Customers afterInsert triggered for:', item._id);
    
    // Send welcome email
    sendWelcomeEmail(item).catch(error => {
        console.error('Welcome email error:', error);
    });
    
    return item;
}

// ========================================================================
// GFE_PROJECTS COLLECTION HOOKS
// ========================================================================

export function GFE_Projects_beforeInsert(item, context) {
    console.log('GFE_Projects beforeInsert triggered');
    
    // Set timestamps
    item.createdDate = new Date();
    item.lastUpdated = new Date();
    
    // Generate project ID if not provided
    if (!item.projectId) {
        item.projectId = generateProjectId();
    }
    
    // Set default status
    if (!item.status) {
        item.status = 'planning';
    }
    
    return item;
}

export function GFE_Projects_afterInsert(item, context) {
    console.log('GFE_Projects afterInsert triggered for:', item._id);
    
    // Update customer project count
    updateCustomerStats(item.customerEmail, 'projectAdded').catch(error => {
        console.error('Customer stats update error:', error);
    });
    
    return item;
}

export function GFE_Projects_beforeUpdate(item, context) {
    console.log('GFE_Projects beforeUpdate triggered');
    
    // Update timestamp
    item.lastUpdated = new Date();
    
    return item;
}

export function GFE_Projects_afterUpdate(item, context) {
    console.log('GFE_Projects afterUpdate triggered for:', item._id);
    
    // Track status changes
    if (context.currentItem && item.status !== context.currentItem.status) {
        trackEvent('project_status_changed', {
            projectId: item.projectId,
            oldStatus: context.currentItem.status,
            newStatus: item.status
        }).catch(error => {
            console.error('Analytics tracking error:', error);
        });
        
        // Update customer if project completed
        if (item.status === 'completed' && item.totalValue) {
            updateCustomerStats(item.customerEmail, 'projectCompleted', item.totalValue).catch(error => {
                console.error('Customer stats update error:', error);
            });
        }
    }
    
    return item;
}

// ========================================================================
// GFE_APPOINTMENTS COLLECTION HOOKS
// ========================================================================

export function GFE_Appointments_beforeInsert(item, context) {
    console.log('GFE_Appointments beforeInsert triggered');
    
    // Set timestamps
    item.createdDate = new Date();
    item.lastUpdated = new Date();
    
    // Generate appointment ID if not provided
    if (!item.appointmentId) {
        item.appointmentId = generateAppointmentId();
    }
    
    // Set default status
    if (!item.status) {
        item.status = 'scheduled';
    }
    
    // Clean email
    if (item.customerEmail) {
        item.customerEmail = item.customerEmail.toLowerCase().trim();
    }
    
    return item;
}

export function GFE_Appointments_afterInsert(item, context) {
    console.log('GFE_Appointments afterInsert triggered for:', item._id);
    
    // Send confirmation email
    sendAppointmentConfirmation(item).catch(error => {
        console.error('Appointment confirmation error:', error);
    });
    
    // Track analytics
    trackEvent('appointment_scheduled', {
        appointmentId: item.appointmentId,
        appointmentType: item.appointmentType,
        customerEmail: item.customerEmail
    }).catch(error => {
        console.error('Analytics tracking error:', error);
    });
    
    return item;
}

// ========================================================================
// UTILITY FUNCTIONS
// ========================================================================

function calculateLeadScore(item) {
    let score = 50; // Base score
    
    if (item.email) score += 20;
    if (item.phone) score += 20;
    if (item.projectType === 'Window Replacement') score += 10;
    if (item.customerAddress) score += 5;
    if (item.notes && item.notes.length > 20) score += 5;
    
    return Math.min(score, 100);
}

function determinePriority(leadScore) {
    if (leadScore >= 80) return 'high';
    if (leadScore >= 60) return 'medium';
    return 'low';
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

function calculateQuoteTotals(windowItems) {
    let subtotal = 0;
    
    windowItems.forEach(item => {
        const itemTotal = (item.unitPrice || 0) * (item.quantity || 1);
        subtotal += itemTotal;
    });
    
    const tax = subtotal * 0.08; // 8% tax
    const total = subtotal + tax;
    
    return {
        subtotal: subtotal,
        tax: tax,
        total: total
    };
}

function generatePriceRange(basePrice) {
    const min = Math.floor(basePrice * 0.8);
    const max = Math.ceil(basePrice * 1.2);
    return `${min.toLocaleString()} - ${max.toLocaleString()}`;
}

function cleanPhoneNumber(phone) {
    return phone.replace(/\D/g, '');
}

function generateQuoteId() {
    return 'GFE-Q-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4).toUpperCase();
}

function generateProjectId() {
    return 'GFE-P-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4).toUpperCase();
}

function generateAppointmentId() {
    return 'GFE-A-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4).toUpperCase();
}

// ========================================================================
// ASYNC HELPER FUNCTIONS
// ========================================================================

async function sendLeadNotifications(leadData) {
    try {
        await fetch(`${BACKEND_URL}/api/notifications/lead-created`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': await wixSecrets.getSecret('BACKEND_API_KEY')
            },
            body: JSON.stringify(leadData)
        });
    } catch (error) {
        console.error('Lead notification error:', error);
    }
}

async function generateQuotePDF(quoteData) {
    try {
        await fetch(`${BACKEND_URL}/api/pdf/generate-quote`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': await wixSecrets.getSecret('BACKEND_API_KEY')
            },
            body: JSON.stringify(quoteData)
        });
    } catch (error) {
        console.error('PDF generation error:', error);
    }
}

async function sendQuoteEmail(quoteData) {
    try {
        await fetch(`${BACKEND_URL}/api/email/send-quote`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': await wixSecrets.getSecret('BACKEND_API_KEY')
            },
            body: JSON.stringify(quoteData)
        });
    } catch (error) {
        console.error('Quote email error:', error);
    }
}

async function sendQuoteAcceptedNotification(quoteData) {
    try {
        await fetch(`${BACKEND_URL}/api/notifications/quote-accepted`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': await wixSecrets.getSecret('BACKEND_API_KEY')
            },
            body: JSON.stringify(quoteData)
        });
    } catch (error) {
        console.error('Quote acceptance notification error:', error);
    }
}

async function sendWelcomeEmail(customerData) {
    try {
        await fetch(`${BACKEND_URL}/api/email/send-welcome`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': await wixSecrets.getSecret('BACKEND_API_KEY')
            },
            body: JSON.stringify(customerData)
        });
    } catch (error) {
        console.error('Welcome email error:', error);
    }
}

async function sendAppointmentConfirmation(appointmentData) {
    try {
        await fetch(`${BACKEND_URL}/api/email/send-appointment-confirmation`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': await wixSecrets.getSecret('BACKEND_API_KEY')
            },
            body: JSON.stringify(appointmentData)
        });
    } catch (error) {
        console.error('Appointment confirmation error:', error);
    }
}

async function updateCustomerStats(customerEmail, action, value = null) {
    try {
        const customer = await wixData.query('GFE_Customers')
            .eq('email', customerEmail)
            .find();
        
        if (customer.items.length > 0) {
            const customerData = customer.items[0];
            const updates = {
                _id: customerData._id,
                lastActivity: new Date()
            };
            
            if (action === 'projectAdded') {
                updates.totalProjects = (customerData.totalProjects || 0) + 1;
            } else if (action === 'projectCompleted' && value) {
                updates.totalSpent = (customerData.totalSpent || 0) + value;
            }
            
            await wixData.update('GFE_Customers', updates);
        }
    } catch (error) {
        console.error('Customer stats update error:', error);
    }
}

async function trackEvent(eventName, eventData) {
    try {
        await wixData.save('GFE_Analytics', {
            event: eventName,
            eventData: eventData,
            timestamp: new Date(),
            source: 'data_hooks'
        });
    } catch (error) {
        console.error('Event tracking error:', error);
    }
}