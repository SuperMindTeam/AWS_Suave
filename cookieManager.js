// cookieManager.js - Background cookie refresh module
// Import this into your server.js

import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';

const COOKIE_FILE = path.join(process.cwd(), 'denticon-cookies.json');
const REFRESH_INTERVAL_MS = 118 * 60 * 1000; // 118 minutes
const COOKIE_MAX_AGE_MS = 115 * 60 * 1000; // 115 minutes (safety buffer)

// Track refresh state
let refreshIntervalId = null;
let isRefreshing = false;
let lastRefreshTime = null;
let refreshCount = 0;

// ============================================
// Cookie File Operations
// ============================================

async function saveCookies(context) {
  try {
    const cookies = await context.cookies();
    const data = {
      cookies,
      timestamp: Date.now(),
      refreshedAt: new Date().toISOString(),
      refreshCount: ++refreshCount
    };
    
    await fs.writeFile(COOKIE_FILE, JSON.stringify(data, null, 2));
    lastRefreshTime = Date.now();
    console.log(`[Cookie Manager] ✓ Saved ${cookies.length} cookies (refresh #${refreshCount})`);
    return true;
  } catch (error) {
    console.error(`[Cookie Manager] ✗ Failed to save cookies: ${error.message}`);
    return false;
  }
}

async function loadCookies() {
  try {
    const data = await fs.readFile(COOKIE_FILE, 'utf-8');
    const { cookies, timestamp } = JSON.parse(data);
    
    const age = Date.now() - timestamp;
    const ageMinutes = Math.round(age / 1000 / 60);
    
    if (age < COOKIE_MAX_AGE_MS && cookies.length > 0) {
      return cookies;
    }
    
    console.log(`[Cookie Manager] ⚠ Cookies expired (age: ${ageMinutes} min)`);
    return null;
  } catch (error) {
    console.log(`[Cookie Manager] ℹ No cookie file found: ${error.message}`);
    return null;
  }
}

// ============================================
// Login & Refresh Logic
// ============================================

async function performLogin(page) 
{
  try
  {
  console.log('[Cookie Manager] 🔐 Performing login...');
  
  await page.goto('https://www.denticon.com/login', { 
    waitUntil: 'load', 
    timeout: 30000 
  });
  
  // Wait for username field to be visible
    await page.waitForSelector('#loginForm > form > div.form-group > input', { 
      timeout: 10000,
      state: 'visible' 
    });

  await page.fill('#loginForm > form > div.form-group > input', 'RecepiaAgent');
  await page.screenshot({ path: 'screenshot-1-username-filled.png', fullPage: true  });
  await page.click('#btnLogin');
  await page.screenshot({ path: 'screenshot-2-after-username-submit.png', fullPage: true  });
  console.log('[Cookie Manager] After clicking username login button');

  await page.waitForSelector('input[name="txtPassword"]', { timeout: 10000 });
  await page.screenshot({ path: 'screenshot-3-password-field-visible.png', fullPage: true  });
  await page.fill('input[name="txtPassword"]', 'Dpnr2025$');
  await page.click('#aLogin');
  await page.screenshot({ path: 'screenshot-5-after-password-submit.png', fullPage: true  });
  console.log('[Cookie Manager] After clicking password login button');
  
  await Promise.race([
      page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }),
      page.waitForURL(url => !url.href.includes('/login'), { timeout: 30000 }),
      page.waitForSelector('body', { timeout: 30000 }) // Fallback
    ]).catch(async (err) => {
      // If navigation times out, check if we're actually logged in
      const url = page.url();
      if (!url.includes('/login')) {
        console.log('[Cookie Manager] ✓ Login successful (no navigation needed)');
        return;
      }
      throw err;
    });
  await page.screenshot({ path: 'screenshot-6-after-everything.png', fullPage: true  });

  console.log('[Cookie Manager] ✓ Login successful');
  }
  catch (error) {
    console.error(`[Cookie Manager] ✗ Login failed: ${error.message}`);
    throw error;
  }
}

async function verifyLoginStatus(page) {
  try {
    await page.goto('https://a1.denticon.com/aspx/home/advancedmypage.aspx?chk=tls', { 
      waitUntil: 'load', 
      timeout: 30000 
    });
    
    const redirectLoginSelector = await page.$('#redirectLogin');
      
      // Print the result as requested by the prompt
      if (redirectLoginSelector) {
          console.log('✅ The #redirectLogin selector WAS found.');
      } else {
          console.log('❌ The #redirectLogin selector WAS NOT found.');
      }
    
    return !!redirectLoginSelector;;
  } catch (error) {
    console.error(`[Cookie Manager] ✗ Error verifying login: ${error.message}`);
    return false;
  }
}

async function refreshCookiesInBackground() {
  // Prevent concurrent refreshes
  if (isRefreshing) {
    console.log('[Cookie Manager] ⏳ Refresh already in progress, skipping...');
    return;
  }

  isRefreshing = true;
  const startTime = Date.now();
  
  console.log('\n' + '─'.repeat(60));
  console.log(`[Cookie Manager] 🔄 Starting cookie refresh #${refreshCount + 1}`);
  console.log(`[Cookie Manager] ⏰ Time: ${new Date().toISOString()}`);
  console.log('─'.repeat(60));
  
  let context = null;
  let page = null;
  
  try {
    // Launch browser in headless mode
    context = await chromium.launchPersistentContext('user-data-dir', {
      headless: true,
      timeout: 120000
    });
    
    page = await context.newPage();
    
    // Try to load existing cookies
    const existingCookies = await loadCookies();
    
    if (existingCookies) {
      await context.addCookies(existingCookies);
      console.log('[Cookie Manager] ✓ Loaded existing cookies');
    }
    
    // Verify login status
    const needsLogin = await verifyLoginStatus(page);
    
    if (needsLogin) {
      console.log('[Cookie Manager] ⚠ Not logged in, performing fresh login...');
      await performLogin(page);
    } else {
      console.log('[Cookie Manager] ✓ Already logged in with existing cookies');
    }
    
    // Save refreshed cookies
    await saveCookies(context);
    
    const duration = Math.round((Date.now() - startTime) / 1000);
    console.log(`[Cookie Manager] ✓ Refresh completed in ${duration}s`);
    console.log('─'.repeat(60) + '\n');
    
  } catch (error) {
    console.error(`[Cookie Manager] ✗ Refresh failed: ${error.message}`);
    console.error(error.stack);
  } finally {
    // Always cleanup
    try {
      if (page) await page.close();
      if (context) await context.close();
    } catch (cleanupError) {
      console.error(`[Cookie Manager] ✗ Cleanup error: ${cleanupError.message}`);
    }
    
    isRefreshing = false;
  }
}

// ============================================
// Public API for server.js
// ============================================

/**
 * Start the background cookie refresh service
 * Call this once when server.js starts
 */
async function startCookieRefresh() {
  console.log('\n' + '═'.repeat(60));
  console.log('[Cookie Manager] 🚀 Cookie Auto-Refresh Service Starting...');
  console.log(`[Cookie Manager] ⏱  Refresh Interval: ${REFRESH_INTERVAL_MS / 60000} minutes`);
  console.log('═'.repeat(60) + '\n');
  
  // Perform initial refresh immediately
  await refreshCookiesInBackground();
  
  // Schedule periodic refreshes
  refreshIntervalId = setInterval(() => {
    refreshCookiesInBackground();
  }, REFRESH_INTERVAL_MS);
  
  console.log('[Cookie Manager] ✓ Background refresh scheduled\n');
}

/**
 * Stop the background cookie refresh service
 * Call this when server is shutting down
 */
function stopCookieRefresh() {
  if (refreshIntervalId) {
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
    console.log('[Cookie Manager] 🛑 Cookie refresh service stopped');
  }
}

/**
 * Get cookie refresh status
 * Useful for health check endpoints
 */
function getRefreshStatus() {
  return {
    isActive: refreshIntervalId !== null,
    isRefreshing,
    lastRefreshTime,
    lastRefreshAgo: lastRefreshTime ? Date.now() - lastRefreshTime : null,
    refreshCount,
    nextRefreshIn: lastRefreshTime ? 
      Math.max(0, REFRESH_INTERVAL_MS - (Date.now() - lastRefreshTime)) : null
  };
}

/**
 * Check if cookies are valid (for use in second.js)
 */
async function areCookiesValid() {
  try {
    const data = await fs.readFile(COOKIE_FILE, 'utf-8');
    const { cookies, timestamp } = JSON.parse(data);
    
    const age = Date.now() - timestamp;
    const ageMinutes = Math.round(age / 1000 / 60);
    
    const isValid = age < COOKIE_MAX_AGE_MS && cookies.length > 0;
    
    if (isValid) {
      console.log(`[Cookie Manager] ✓ Cookies valid (age: ${ageMinutes} min)`);
    } else {
      console.log(`[Cookie Manager] ✗ Cookies invalid (age: ${ageMinutes} min)`);
    }
    
    return isValid ? cookies : null;
  } catch (error) {
    console.log(`[Cookie Manager] ✗ No valid cookies: ${error.message}`);
    return null;
  }
}

/**
 * Force an immediate cookie refresh
 * Useful for testing or manual triggers
 */
async function forceRefresh() {
  console.log('[Cookie Manager] 🔄 Manual refresh triggered...');
  await refreshCookiesInBackground();
}

// ============================================
// Export Public API
// ============================================

export {
  startCookieRefresh,
  stopCookieRefresh,
  getRefreshStatus,
  areCookiesValid,
  forceRefresh,
  saveCookies,
  performLogin
};

// ============================================
// Updated second.js - searchDenticonPatient function
// ============================================

/*
// second.js - Updated version

import { chromium } from 'playwright';
import { areCookiesValid, saveCookies, performLogin } from './cookieManager.js';

async function searchDenticonPatient(officeName, patientDoB, firstName, lastName) {
  const context = await chromium.launchPersistentContext('user-data-dir', {
    headless: true,
    timeout: 120000
  });
  
  const page = await context.newPage();
  
  try {
    // Try to load cookies (should always be available with background refresh)
    const savedCookies = await areCookiesValid();
    
    if (savedCookies) {
      await context.addCookies(savedCookies);
      
      await page.goto('https://a1.denticon.com/aspx/home/advancedmypage.aspx?chk=tls', { 
        waitUntil: 'load', 
        timeout: 30000 
      });
      
      // Verify we're logged in
      const isLoggedIn = await page.evaluate(() => {
        return !document.querySelector('#loginForm');
      });
      
      if (!isLoggedIn) {
        console.log('⚠ Cookies failed validation - performing emergency login');
        console.log('⚠ This should rarely happen - check cookie refresh service!');
        await performLogin(page);
        await saveCookies(context);
      } else {
        console.log('✓ Authenticated with background-refreshed cookies');
      }
    } else {
      console.log('⚠ No valid cookies found - this is unusual!');
      console.log('⚠ Check if cookie refresh service is running in server.js');
      
      // Emergency fallback login
      await performLogin(page);
      await saveCookies(context);
    }
    
    // Continue with your patient search
    console.log('2. Selecting office...');
    await page.waitForSelector('#officeSearchFullList', { state: 'visible' });
    await page.click('#officeSearchFullList');
    
    // ... rest of your search logic ...
    
    return { success: true, data: yourResults };
    
  } catch (error) {
    console.error(`Error in searchDenticonPatient: ${error.message}`);
    throw error;
  } finally {
    await page.close();
    await context.close();
  }
}

export { searchDenticonPatient };
*/