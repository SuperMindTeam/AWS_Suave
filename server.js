import https from "https";
import fs from "fs";
import express from "express";
import cors from "cors";
import { searchDenticonPatient } from "./second.js";
import { 
  startCookieRefresh, 
  stopCookieRefresh, 
  getRefreshStatus,
  forceRefresh 
} from './cookieManager.js';

const PORT = 443;

const sslOptions = {
  key: fs.readFileSync("/etc/letsencrypt/live/savehdvideo.com/privkey.pem"),
  cert: fs.readFileSync("/etc/letsencrypt/live/savehdvideo.com/fullchain.pem"),
};

const app = express();
//const PORT = process.env.PORT || 3000;



app.use(express.json());

// Branch name mapping with pre-normalized keys
const BRANCH_MAP = {
  "livingston": "Suave Dental Livingston [105] ",
  "los banos": "Suave Dental Los Banos [101] ",
  "merced": "Suave Dental Merced [110] ",
  "modesto": "Suave Dental Modesto [103] ",
  "riverbank": "Suave Dental Riverbank [104] ",
  "roseville": "Suave Dental Roseville [109] ",
  "stockton": "Suave Dental Stockton [102] ",
  "west sacramento": "Suave Dental West Sacramento [106] ",
  "sacramento": "Suave Dental West Sacramento [106] "
};

// Pre-compute sorted keys by length (longest first) for partial matching
const SORTED_KEYS = Object.keys(BRANCH_MAP).sort((a, b) => b.length - a.length);

// Function to normalize and map branch names
function normalizeBranchName(branchInput) {
  if (!branchInput) return null;
  
  if (branchInput.includes('[')) {
    return branchInput;
  }
  const normalized = branchInput.toLowerCase().trim();
  
  const exact = BRANCH_MAP[normalized];
  if (exact) return exact;
  
  for (let i = 0; i < SORTED_KEYS.length; i++) {
    if (normalized.includes(SORTED_KEYS[i])) {
      return BRANCH_MAP[SORTED_KEYS[i]];
    }
  }
  console.warn(`No branch mapping found for: ${branchInput}`);
  return branchInput;
}

// ============================================
// Health Check & Status Endpoints
// ============================================

app.get('/health', (req, res) => {
  const status = getRefreshStatus();
  
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    cookieRefresh: {
      active: status.isActive,
      currentlyRefreshing: status.isRefreshing,
      lastRefreshAgo: status.lastRefreshAgo 
        ? `${Math.round(status.lastRefreshAgo / 60000)} minutes ago` 
        : 'never',
      nextRefreshIn: status.nextRefreshIn 
        ? `${Math.round(status.nextRefreshIn / 60000)} minutes` 
        : 'N/A',
      totalRefreshes: status.refreshCount
    }
  });
});

app.get('/cookie-status', (req, res) => {
  const status = getRefreshStatus();
  
  res.json({
    isActive: status.isActive,
    isRefreshing: status.isRefreshing,
    lastRefreshTime: status.lastRefreshTime 
      ? new Date(status.lastRefreshTime).toISOString() 
      : null,
    lastRefreshAgoMinutes: status.lastRefreshAgo 
      ? Math.round(status.lastRefreshAgo / 60000) 
      : null,
    nextRefreshInMinutes: status.nextRefreshIn 
      ? Math.round(status.nextRefreshIn / 60000) 
      : null,
    refreshCount: status.refreshCount
  });
});

// Manual refresh trigger (optional - for testing/debugging)
app.post('/refresh-cookies', async (req, res) => {
  try {
    console.log('[Server] Manual cookie refresh triggered via API');
    
    // Don't await - let it run in background
    forceRefresh().catch(err => {
      console.error('[Server] Manual refresh error:', err);
    });
    
    res.json({ 
      message: 'Cookie refresh initiated in background',
      status: 'processing'
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to trigger refresh',
      message: error.message 
    });
  }
});

// ============================================
// Your Existing API Endpoints
// ============================================

app.post("/lookup", async (req, res) => {
  const startTime = Date.now();

  const logTime2 = (msg) => {
    const seconds = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`⏱️ [${seconds}s] ${msg}`);
};
  //console.log('=== LOOKUP REQUEST RECEIVED ===');
  //console.log('Request body:', JSON.stringify(req.body, null, 2));

// Helper function to print elapsed time easily

  try {
    let suaveBranch, dob, firstName, lastName;
              logTime2('Check if vapi or not');

    // Check if this is a VAPI tool call format
    if (req.body.message && req.body.message.toolCalls) {
      //console.log('VAPI format detected');
      const toolCall = req.body.message.toolCalls[0];
      const args = toolCall.function.arguments;
      
      suaveBranch = args.suaveBranch;
      dob = args.dob;
      firstName = args.firstName;
      lastName = args.lastName;
    } 
    // Direct format (for manual testing)
    else {
      //console.log('Direct format detected');
      suaveBranch = req.body.suaveBranch;
      dob = req.body.dob;
      firstName = req.body.firstName;
      lastName = req.body.lastName;
    }
                  logTime2('after if vapi or not');

    //console.log('Extracted params:', { suaveBranch, firstName, lastName, dob });


    
    if (!suaveBranch || !firstName || !lastName || !dob) {
      console.log('Missing required fields');
      return res.status(200).json({ 
        error: "Missing required fields",
        message: "Please provide suaveBranch, firstName, lastName, and dob"
      });
    }
    logTime2('after parameter check');
    
    // Normalize the branch name
    const normalizedBranch = normalizeBranchName(suaveBranch);
    //console.log(`Branch mapping: "${suaveBranch}" -> "${normalizedBranch}"`);
          //logTime('Calling searchDenticonPatient.');

    console.log('Calling searchDenticonPatient...');
        logTime2('after normalized');

    const data = await searchDenticonPatient(normalizedBranch, dob, firstName, lastName);
    const duration = Date.now() - startTime;
    console.log(`Patient data received in ${duration}ms:`, data);

    //console.log('Patient data received:', JSON.stringify(data, null, 2));
    
    // Format response for VAPI
    const response = {
      PatientName: data.patientName || "No patient record found",
      DoctorName: data.provider || "N/A",
      PatientLastVisit: data.lastVisit || "N/A",
      treatmentrows: data.treatmentrows?.length ? data.treatmentrows : "N/A"
      //commentText: data.commentText || "No comments",
    };
    
    //console.log('Sending response:', JSON.stringify(response, null, 2));
    
    return res.status(200).json(response);
    
  } catch (err) {
    console.error("=== LOOKUP ERROR ===");
    console.error(err);
    
    return res.status(200).json({ 
      error: true,
      message: err.message || "Failed to lookup patient",
      patientName: "Not found",
      provider: "Error occurred",
      lastVisit: "N/A"
      //alertText: "Lookup failed",
      //commentText: err.message
    });
  }
});

// ... add your other endpoints here ...

// ============================================
// Server Startup & Graceful Shutdown
// ============================================

async function startServer() {
  try {
    // Start the cookie refresh service FIRST
    console.log('[Server] Initializing cookie refresh service...');
    await startCookieRefresh();
    
    // Then start the Express server
    https.createServer(sslOptions, app).listen(PORT, () => {
      console.log('\n' + '═'.repeat(60));
      console.log(`[Server] 🚀 Server running on port ${PORT}`);
      console.log(`[Server] 🍪 Cookie auto-refresh: ACTIVE`);
      console.log(`[Server] 📊 Health check: http://localhost:${PORT}/health`);
      console.log(`[Server] 📈 Cookie status: http://localhost:${PORT}/cookie-status`);
      console.log('═'.repeat(60) + '\n');
    });
  } catch (error) {
    console.error('[Server] Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
function gracefulShutdown(signal) {
  console.log(`\n[Server] ${signal} received, shutting down gracefully...`);
  
  // Stop cookie refresh
  stopCookieRefresh();
  
  // Close server
  console.log('[Server] Server closed');
  process.exit(0);
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('[Server] Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit on unhandled rejection - just log it
});

// Start the server
startServer();

// ============================================
// Optional: Monitoring & Alerts
// ============================================

// Check cookie refresh health every 30 minutes
setInterval(() => {
  const status = getRefreshStatus();
  
  // Alert if last refresh was more than 130 minutes ago
  if (status.lastRefreshAgo && status.lastRefreshAgo > 130 * 60 * 1000) {
    console.error('🚨 [Server] ALERT: Cookie refresh is stale!');
    console.error(`    Last refresh: ${Math.round(status.lastRefreshAgo / 60000)} minutes ago`);
    console.error('    Expected: < 130 minutes');
    
    // You could send an email/SMS alert here
    // Or call forceRefresh() to try again
  }
}, 30 * 60 * 1000); // Check every 30 minutes










