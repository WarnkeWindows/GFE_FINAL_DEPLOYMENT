/**
 * ========================================================================
 * GOOD FAITH EXTERIORS - LEADS API ENDPOINT
 * ========================================================================
 * RESTful API endpoint for lead management
 * File: backend-integration/api-endpoints/leads-api.js
 */

import { ok, badRequest, serverError, forbidden, notFound } from 'wix-http-functions';
import wixData from 'wix-data';
import wixCrm from 'wix-crm-backend';
import wixSecrets from 'wix-secrets-backend';
import { fetch } from 'wix-fetch';

const BACKEND_URL = "https://gfe-backend-837326026335.us-central1.run.app";
const COLLECTION_NAME = 'GFE_Leads';

// ========================================================================
// CREATE LEAD - POST /api/leads
// ========================================================================

export async function post_leads(request) {
    try {
        console.log('POST /api/leads - Creating new lead');
        
        const leadData = await request.body.json();
        
        // Validate request data
        const validation = validateLeadData(leadData);
        if (!validation.isValid) {
            return badRequest({
                success: false,
                error: 'Validation failed',
                details: validation.errors
            });
        }
        
        // Check for duplicate leads (same email within 24 hours)
        const duplicateCheck = await checkForDuplicateLead(leadData.email);
        if (duplicateCheck.isDuplicate) {
            return badRequest({
                success: false,
                error: 'Duplicate lead detected',
                message: 'A lead with this email was already created within the last 24 hours',
                existingLeadId: duplicateCheck.existingLead._id
            });
        }
        
        // Process and enrich lead data
        const processedLead = await processLeadData(leadData);
        
        // Save to Wix Data collection
        const savedLead = await wixData.save(COLLECTION_NAME, processedLead);
        
        // Create CRM contact
        const crmContact = await createCrmContact(savedLead);
        
        // Send notifications
        await sendLeadNotifications(savedLead);
        
        // Track analytics
        await trackLeadEvent('lead_created', savedLead);
        
        // Return success response
        return ok({
            success: true,
            message: 'Lead created successfully',
            lead: {
                id: savedLead._id,
                leadScore: savedLead.leadScore,
                priority: savedLead.priority,
                assignedTo: savedLead.assignedTo,
                followUpDate: savedLead.followUpDate
            },
            crmContactId: crmContact?.contactId || null
        });
        
    } catch (error) {
        console.error('Error creating lead:', error);
        return serverError({
            success: false,
            error: 'Failed to create lead',
            message: error.message
        });
    }
}

// ========================================================================
// GET LEADS - GET /api/leads
// ========================================================================

export async function get_leads(request) {
    try {
        console.log('GET /api/leads - Retrieving leads');
        
        // Parse query parameters
        const query = request.query || {};
        const {
            page = 1,
            limit = 50,
            status,
            priority,
            source,
            assignedTo,
            startDate,
            endDate,
            search,
            sortBy = '_createdDate',
            sortOrder = 'desc'
        } = query;
        
        // Validate pagination parameters
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const skip = (pageNum - 1) * limitNum;
        
        // Build query
        let queryBuilder = wixData.query(COLLECTION_NAME)
            .limit(limitNum)
            .skip(skip);
        
        // Apply sorting
        if (sortOrder === 'desc') {
            queryBuilder = queryBuilder.descending(sortBy);
        } else {
            queryBuilder = queryBuilder.ascending(sortBy);
        }
        
        // Apply filters
        if (status) {
            queryBuilder = queryBuilder.eq('status', status);
        }
        
        if (priority) {
            queryBuilder = queryBuilder.eq('priority', priority);
        }
        
        if (source) {
            queryBuilder = queryBuilder.eq('source', source);
        }
        
        if (assignedTo) {
            queryBuilder = queryBuilder.eq('assignedTo', assignedTo);
        }
        
        if (startDate) {
            queryBuilder = queryBuilder.ge('_createdDate', new Date(startDate));
        }
        
        if (endDate) {
            queryBuilder = queryBuilder.le('_createdDate', new Date(endDate));
        }
        
        if (search) {
            // Search in multiple fields
            queryBuilder = queryBuilder.or(
                wixData.query(COLLECTION_NAME).contains('fullName', search),
                wixData.query(COLLECTION_NAME).contains('email', search),
                wixData.query(COLLECTION_NAME).contains('phone', search)
            );
        }
        
        // Execute query
        const results = await queryBuilder.find();
        
        // Get summary statistics
        const stats = await getLeadStatistics();
        
        return ok({
            success: true,
            leads: results.items.map(sanitizeLeadData),
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: results.totalCount,
                hasMore: results.hasNext(),
                totalPages: Math.ceil(results.totalCount / limitNum)
            },
            stats: stats
        });
        
    } catch (error) {
        console.error('Error retrieving leads:', error);
        return serverError({
            success: false,
            error: 'Failed to retrieve leads',
            message: error.message
        });
    }
}

// ========================================================================
// GET SINGLE LEAD - GET /api/leads/{leadId}
// ========================================================================

export async function get_leads_leadId(request) {
    try {
        const leadId = request.path[0];
        
        if (!leadId) {
            return badRequest({
                success: false,
                error: 'Lead ID is required'
            });
        }
        
        console.log(`GET /api/leads/${leadId} - Retrieving single lead`);
        
        // Get lead from database
        const lead = await wixData.get(COLLECTION_NAME, leadId);
        
        if (!lead) {
            return notFound({
                success: false,
                error: 'Lead not found'
            });
        }
        
        // Get related data
        const relatedData = await getRelatedLeadData(lead);
        
        return ok({
            success: true,
            lead: sanitizeLeadData(lead),
            related: relatedData
        });
        
    } catch (error) {
        console.error('Error retrieving lead:', error);
        
        if (error.code === 'WD_ERROR_INVALID_ID') {
            return notFound({
                success: false,
                error: 'Lead not found'
            });
        }
        
        return serverError({
            success: false,
            error: 'Failed to retrieve lead',
            message: error.message
        });
    }
}

// ========================================================================
// UPDATE LEAD - PUT /api/leads/{leadId}
// ========================================================================

export async function put_leads_leadId(request) {
    try {
        const leadId = request.path[0];
        const updateData = await request.body.json();
        
        if (!leadId) {
            return badRequest({
                success: false,
                error: 'Lead ID is required'
            });
        }
        
        console.log(`PUT /api/leads/${leadId} - Updating lead`);
        
        // Get existing lead
        const existingLead = await wixData.get(COLLECTION_NAME, leadId);
        
        if (!existingLead) {
            return notFound({
                success: false,
                error: 'Lead not found'
            });
        }
        
        // Validate update data
        const validation = validateLeadUpdateData(updateData);
        if (!validation.isValid) {
            return badRequest({
                success: false,
                error: 'Validation failed',
                details: validation.errors
            });
        }
        
        // Process update data
        const processedUpdate = await processLeadUpdateData(updateData, existingLead);
        
        // Update lead
        const updatedLead = await wixData.update(COLLECTION_NAME, {
            _id: leadId,
            ...processedUpdate
        });
        
        // Track status changes
        if (updateData.status && updateData.status !== existingLead.status) {
            await trackLeadStatusChange(existingLead, updatedLead);
        }
        
        // Send notifications for important changes
        await sendUpdateNotifications(existingLead, updatedLead);
        
        return ok({
            success: true,
            message: 'Lead updated successfully',
            lead: sanitizeLeadData(updatedLead)
        });
        
    } catch (error) {
        console.error('Error updating lead:', error);
        return serverError({
            success: false,
            error: 'Failed to update lead',
            message: error.message
        });
    }
}

// ========================================================================
// DELETE LEAD - DELETE /api/leads/{leadId}
// ========================================================================

export async function delete_leads_leadId(request) {
    try {
        const leadId = request.path[0];
        
        if (!leadId) {
            return badRequest({
                success: false,
                error: 'Lead ID is required'
            });
        }
        
        console.log(`DELETE /api/leads/${leadId} - Deleting lead`);
        
        // Get lead before deletion for logging
        const lead = await wixData.get(COLLECTION_NAME, leadId);
        
        if (!lead) {
            return notFound({
                success: false,
                error: 'Lead not found'
            });
        }
        
        // Archive instead of delete (soft delete)
        const archivedLead = await wixData.update(COLLECTION_NAME, {
            _id: leadId,
            status: 'archived',
            archivedDate: new Date(),
            archivedBy: 'api'
        });
        
        // Track deletion
        await trackLeadEvent('lead_archived', archivedLead);
        
        return ok({
            success: true,
            message: 'Lead archived successfully'
        });
        
    } catch (error) {
        console.error('Error archiving lead:', error);
        return serverError({
            success: false,
            error: 'Failed to archive lead',
            message: error.message
        });
    }
}

// ========================================================================
// LEAD STATISTICS - GET /api/leads/stats
// ========================================================================

export async function get_leads_stats(request) {
    try {
        console.log('GET /api/leads/stats - Retrieving lead statistics');
        
        const stats = await getDetailedLeadStatistics();
        
        return ok({
            success: true,
            stats: stats
        });
        
    } catch (error) {
        console.error('Error retrieving lead statistics:', error);
        return serverError({
            success: false,
            error: 'Failed to retrieve statistics',
            message: error.message
        });
    }
}

// ========================================================================
// UTILITY FUNCTIONS
// ========================================================================

function validateLeadData(data) {
    const errors = [];
    
    // Required fields
    if (!data.fullName || data.fullName.trim().length < 2) {
        errors.push('Full name is required and must be at least 2 characters');
    }
    
    if (!data.email || !isValidEmail(data.email)) {
        errors.push('Valid email address is required');
    }
    
    // Optional field validation
    if (data.phone && !isValidPhone(data.phone)) {
        errors.push('Phone number format is invalid');
    }
    
    if (data.projectType && !isValidProjectType(data.projectType)) {
        errors.push('Invalid project type');
    }
    
    if (data.source && !isValidSource(data.source)) {
        errors.push('Invalid lead source');
    }
    
    return {
        isValid: errors.length === 0,
        errors: errors
    };
}

function validateLeadUpdateData(data) {
    const errors = [];
    
    // Validate only provided fields
    if (data.email && !isValidEmail(data.email)) {
        errors.push('Invalid email format');
    }
    
    if (data.phone && !isValidPhone(data.phone)) {
        errors.push('Invalid phone format');
    }
    
    if (data.status && !isValidStatus(data.status)) {
        errors.push('Invalid status value');
    }
    
    if (data.priority && !isValidPriority(data.priority)) {
        errors.push('Invalid priority value');
    }
    
    if (data.leadScore && (data.leadScore < 0 || data.leadScore > 100)) {
        errors.push('Lead score must be between 0 and 100');
    }
    
    return {
        isValid: errors.length === 0,
        errors: errors
    };
}

async function processLeadData(leadData) {
    // Calculate lead score
    const leadScore = calculateLeadScore(leadData);
    
    // Determine priority
    const priority = determinePriority(leadScore);
    
    // Assign to team member
    const assignedTo = await assignToTeamMember(leadData);
    
    // Set follow-up date
    const followUpDate = calculateFollowUpDate(priority);
    
    return {
        fullName: leadData.fullName.trim(),
        email: leadData.email.toLowerCase().trim(),
        phone: cleanPhoneNumber(leadData.phone || ''),
        projectType: leadData.projectType || 'Window Replacement',
        customerAddress: leadData.customerAddress || '',
        notes: leadData.notes || '',
        source: leadData.source || 'Website',
        status: 'new',
        leadScore: leadScore,
        priority: priority,
        assignedTo: assignedTo,
        followUpDate: followUpDate,
        estimatedProjectValue: leadData.estimatedProjectValue || null,
        leadData: leadData.leadData || {},
        marketingOptIn: leadData.marketingOptIn || false,
        tags: leadData.tags || [],
        sessionId: leadData.sessionId || null,
        utmParams: leadData.utmParams || {},
        createdDate: new Date(),
        lastUpdated: new Date()
    };
}

async function processLeadUpdateData(updateData, existingLead) {
    const processed = { ...updateData };
    
    // Update timestamp
    processed.lastUpdated = new Date();
    
    // Recalculate lead score if relevant fields changed
    const scoringFields = ['email', 'phone', 'projectType', 'customerAddress', 'notes'];
    const hasScoringChanges = scoringFields.some(field => 
        updateData.hasOwnProperty(field) && updateData[field] !== existingLead[field]
    );
    
    if (hasScoringChanges) {
        const mergedData = { ...existingLead, ...updateData };
        processed.leadScore = calculateLeadScore(mergedData);
        processed.priority = determinePriority(processed.leadScore);
    }
    
    // Update follow-up date if priority changed
    if (processed.priority && processed.priority !== existingLead.priority) {
        processed.followUpDate = calculateFollowUpDate(processed.priority);
    }
    
    // Clean phone number if provided
    if (processed.phone) {
        processed.phone = cleanPhoneNumber(processed.phone);
    }
    
    // Clean email if provided
    if (processed.email) {
        processed.email = processed.email.toLowerCase().trim();
    }
    
    return processed;
}

async function checkForDuplicateLead(email) {
    try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        
        const existingLeads = await wixData.query(COLLECTION_NAME)
            .eq('email', email.toLowerCase().trim())
            .ge('_createdDate', yesterday)
            .find();
        
        return {
            isDuplicate: existingLeads.items.length > 0,
            existingLead: existingLeads.items[0] || null
        };
    } catch (error) {
        console.error('Error checking for duplicate lead:', error);
        return { isDuplicate: false, existingLead: null };
    }
}

async function createCrmContact(leadData) {
    try {
        const nameParts = leadData.fullName.split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';
        
        const contact = await wixCrm.createContact({
            name: {
                first: firstName,
                last: lastName
            },
            emails: [leadData.email],
            phones: leadData.phone ? [leadData.phone] : [],
            addresses: leadData.customerAddress ? [{
                street: leadData.customerAddress
            }] : [],
            labels: ['GFE Lead', leadData.projectType, leadData.source],
            customFields: {
                'leadScore': leadData.leadScore.toString(),
                'priority': leadData.priority,
                'source': leadData.source
            }
        });
        
        return contact;
    } catch (error) {
        console.error('Error creating CRM contact:', error);
        return null;
    }
}

async function getRelatedLeadData(lead) {
    try {
        // Get related quotes
        const quotes = await wixData.query('GFE_Quotes')
            .eq('customerEmail', lead.email)
            .find();
        
        // Get related appointments
        const appointments = await wixData.query('GFE_Appointments')
            .eq('customerEmail', lead.email)
            .find();
        
        // Get related projects
        const projects = await wixData.query('GFE_Projects')
            .eq('customerEmail', lead.email)
            .find();
        
        return {
            quotes: quotes.items || [],
            appointments: appointments.items || [],
            projects: projects.items || []
        };
    } catch (error) {
        console.error('Error getting related lead data:', error);
        return {
            quotes: [],
            appointments: [],
            projects: []
        };
    }
}

function sanitizeLeadData(lead) {
    // Remove sensitive or internal fields from response
    const sanitized = { ...lead };
    delete sanitized.sessionId;
    delete sanitized.utmParams;
    return sanitized;
}

// Helper functions for validation
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function isValidPhone(phone) {
    const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
    return phoneRegex.test(phone.replace(/[\s\-\(\)]/g, ''));
}

function isValidProjectType(type) {
    const validTypes = [
        'Window Replacement',
        'New Construction',
        'Door Installation',
        'Repair/Maintenance',
        'Consultation',
        'General Inquiry'
    ];
    return validTypes.includes(type);
}

function isValidSource(source) {
    const validSources = [
        'Website',
        'AI Estimator',
        'Referral',
        'Social Media',
        'Google Ads',
        'Phone Call',
        'Email',
        'Trade Show',
        'Direct Mail',
        'Other'
    ];
    return validSources.includes(source);
}

function isValidStatus(status) {
    const validStatuses = [
        'new',
        'contacted',
        'qualified',
        'quoted',
        'appointment_scheduled',
        'in_progress',
        'closed_won',
        'closed_lost',
        'on_hold',
        'archived'
    ];
    return validStatuses.includes(status);
}

function isValidPriority(priority) {
    const validPriorities = ['low', 'medium', 'high', 'urgent'];
    return validPriorities.includes(priority);
}

// Lead scoring and assignment logic
function calculateLeadScore(leadData) {
    let score = 50; // Base score
    
    if (leadData.email) score += 20;
    if (leadData.phone) score += 20;
    if (leadData.projectType === 'Window Replacement') score += 10;
    if (leadData.customerAddress) score += 5;
    if (leadData.notes && leadData.notes.length > 20) score += 5;
    if (leadData.estimatedProjectValue > 10000) score += 15;
    if (leadData.source === 'Referral') score += 10;
    
    return Math.min(score, 100);
}

function determinePriority(leadScore) {
    if (leadScore >= 80) return 'high';
    if (leadScore >= 60) return 'medium';
    return 'low';
}

async function assignToTeamMember(leadData) {
    // Simple round-robin assignment
    const teamMembers = [
        'nick@goodfaithexteriors.com',
        'rich@goodfaithexteriors.com',
        'sales@goodfaithexteriors.com'
    ];
    
    // High priority leads go to owners
    if (leadData.priority === 'high' || leadData.estimatedProjectValue > 15000) {
        return teamMembers[Math.floor(Math.random() * 2)]; // Nick or Rich
    }
    
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

function cleanPhoneNumber(phone) {
    return phone.replace(/\D/g, '');
}

// Analytics and notification functions
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
        console.error('Error sending lead notifications:', error);
    }
}

async function sendUpdateNotifications(oldLead, newLead) {
    try {
        const importantChanges = ['status', 'priority', 'assignedTo'];
        const hasImportantChanges = importantChanges.some(field => 
            oldLead[field] !== newLead[field]
        );
        
        if (hasImportantChanges) {
            await fetch(`${BACKEND_URL}/api/notifications/lead-updated`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': await wixSecrets.getSecret('BACKEND_API_KEY')
                },
                body: JSON.stringify({
                    oldLead: oldLead,
                    newLead: newLead,
                    changes: importantChanges.filter(field => oldLead[field] !== newLead[field])
                })
            });
        }
    } catch (error) {
        console.error('Error sending update notifications:', error);
    }
}

async function trackLeadEvent(eventName, leadData) {
    try {
        await wixData.save('GFE_Analytics', {
            event: eventName,
            eventData: {
                leadId: leadData._id,
                source: leadData.source,
                priority: leadData.priority,
                leadScore: leadData.leadScore
            },
            timestamp: new Date(),
            source: 'leads_api'
        });
    } catch (error) {
        console.error('Error tracking lead event:', error);
    }
}

async function trackLeadStatusChange(oldLead, newLead) {
    try {
        await wixData.save('GFE_Analytics', {
            event: 'lead_status_changed',
            eventData: {
                leadId: newLead._id,
                oldStatus: oldLead.status,
                newStatus: newLead.status,
                assignedTo: newLead.assignedTo
            },
            timestamp: new Date(),
            source: 'leads_api'
        });
    } catch (error) {
        console.error('Error tracking status change:', error);
    }
}

async function getLeadStatistics() {
    try {
        const [total, newLeads, contactedLeads, qualifiedLeads] = await Promise.all([
            wixData.query(COLLECTION_NAME).count(),
            wixData.query(COLLECTION_NAME).eq('status', 'new').count(),
            wixData.query(COLLECTION_NAME).eq('status', 'contacted').count(),
            wixData.query(COLLECTION_NAME).eq('status', 'qualified').count()
        ]);
        
        return {
            total: total,
            new: newLeads,
            contacted: contactedLeads,
            qualified: qualifiedLeads
        };
    } catch (error) {
        console.error('Error getting lead statistics:', error);
        return {
            total: 0,
            new: 0,
            contacted: 0,
            qualified: 0
        };
    }
}

async function getDetailedLeadStatistics() {
    try {
        // Get various statistics in parallel
        const [
            totalCount,
            statusStats,
            priorityStats,
            sourceStats,
            recentLeads
        ] = await Promise.all([
            wixData.query(COLLECTION_NAME).count(),
            getStatsByField('status'),
            getStatsByField('priority'),
            getStatsByField('source'),
            wixData.query(COLLECTION_NAME)
                .ge('_createdDate', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
                .count()
        ]);
        
        return {
            total: totalCount,
            recentWeek: recentLeads,
            byStatus: statusStats,
            byPriority: priorityStats,
            bySource: sourceStats,
            conversionRate: await calculateConversionRate()
        };
    } catch (error) {
        console.error('Error getting detailed statistics:', error);
        return {};
    }
}

async function getStatsByField(fieldName) {
    try {
        const allLeads = await wixData.query(COLLECTION_NAME)
            .limit(1000)
            .find();
        
        const stats = {};
        allLeads.items.forEach(lead => {
            const value = lead[fieldName] || 'unknown';
            stats[value] = (stats[value] || 0) + 1;
        });
        
        return stats;
    } catch (error) {
        console.error(`Error getting stats for ${fieldName}:`, error);
        return {};
    }
}

async function calculateConversionRate() {
    try {
        const [totalLeads, convertedLeads] = await Promise.all([
            wixData.query(COLLECTION_NAME).count(),
            wixData.query(COLLECTION_NAME).eq('status', 'closed_won').count()
        ]);
        
        return totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(2) : 0;
    } catch (error) {
        console.error('Error calculating conversion rate:', error);
        return 0;
    }
}