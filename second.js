import { chromium } from "playwright";
import { areCookiesValid, saveCookies, performLogin } from './cookieManager.js';


// 1. Initialize the timer
const startTime = Date.now();

// Helper function to print elapsed time easily
const logTime = (msg) => {
    const seconds = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`⏱️ [${seconds}s] ${msg}`);
};

async function extractPatientMedicalAlerts(overviewIframe) {
  let alertText = null;
  let commentText = null;

  try {
    // Look for medical alert element
    const alertElement = await overviewIframe.$('.patient-medical-alert');
    if (alertElement) {
      const rawAlertText = await alertElement.textContent();
      if (rawAlertText && rawAlertText.trim()) {
        alertText = rawAlertText.trim();
        console.log("MEDICAL ALERTS:");
        console.log(`   ${alertText}`);
      }
    }

    // Check for additional comments
    const commentElement = await overviewIframe.$('.patient-addintional-comment');
    if (commentElement) {
      const fullText = (await commentElement.textContent()) || '';
      // Try to find label inside the comment element
      const labelSpan = await commentElement.$('.patient-addintional-comment-label');

      if (labelSpan) {
        const labelText = (await labelSpan.textContent()) || '';
        // Remove the label text from the full text
        commentText = fullText.replace(labelText, '').trim();
      } else {
        // Fallback: remove common prefix if present
        commentText = fullText.replace(/Additional Comments:\s*/i, '').trim();
      }

      if (commentText) {
        console.log(`   Additional Comments: ${commentText}`);
      } else {
        // if it becomes an empty string, keep it null
        commentText = null;
      }
    } else {
      console.log("\n No medical alerts");
    }
  } catch (e) {
    console.log("⚠️ Could not check medical alerts:", e.message);
  }

  return {
    alertText: alertText ?? null,
    commentText: commentText ?? null
  };
}

function patientExists(patients, first, last) {
  const f = first.toLowerCase();
  const l = last.toLowerCase();
  const pattern1 = f + l;
  const pattern2 = l + f;
  
  for (const p of patients) {
    const s = p._normalized || String(p.text || "").toLowerCase();
    if (s.includes(pattern1) || s.includes(pattern2)) {
      return p;
    }
  }
  return undefined;
}

async function closePopups(page) {
  try {
    // The flash alert popup is always in frame 3 (PatientOverview/Index)
    const frames = page.frames();
    
    // Direct access to the known frame
    const targetFrame = frames.find(frame => 
      frame.url().includes('c1.denticon.com/PatientOverview/Index')
    );
    
    if (!targetFrame) {
      console.log("   ℹ️ Target frame not found");
      return;
    }
    
    console.log(`   🎯 Checking frame: ${targetFrame.url()}`);
    
    // Check if flash alert exists in this specific frame
    const alertExists = await targetFrame.$('#falsh-alert').catch(() => null);
    
    if (!alertExists) {
      console.log("   ℹ️ No flash alert popup found");
      return;
    }
    
    console.log("   ⚠️ Found flash alert popup");
    
    // Try primary close button
    try {
      await targetFrame.click('#btn-close-flash-alert-modal', { force: true, timeout: 3000 });
      console.log("   ✅ Flash alert popup closed");
      // 2. Wait for the MODAL ITSELF to hide (The line you asked about)
      await targetFrame.locator('#falsh-alert').waitFor({ state: 'hidden', timeout: 3000 });
      //await page.waitForTimeout(1000);
      const overlay = page.locator('#overlay-menubar');
      if (await overlay.isVisible()) {
          await overlay.waitFor({ state: 'hidden', timeout: 3000 });
      }
      return;
    } catch (e) {
      console.log("   ⚠️ Primary close button failed, trying CLOSE button");
    }
    
    // Fallback to CLOSE button
    try {
      await targetFrame.click('button:has-text("CLOSE")', { force: true, timeout: 3000 });
      console.log("   ✅ Flash alert popup closed using CLOSE button");
      await page.waitForTimeout(1000);
    } catch (e2) {
      console.log("   ⚠️ Could not close popup:", e2.message);
    }
    
  } catch (error) {
    console.log("   ⚠️ Error handling popup:", error.message);
  }
}


async function extractPatientDetails(overviewIframe, page) 
{

// Wait for patient details to load
  await overviewIframe.waitForSelector('.patient-name', { 
    state: 'visible', 
    timeout: 6000 
  });
  //console.log("   ✅ Patient overview loaded");
        logTime('before evaluating patient details from individual page');
  // Extract everything in one evaluation block (FAST)
  const data = await overviewIframe.evaluate(() => {
    const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || null;
    
    return {
      patientName: getText('.patient-name'),
      lastVisit: (() => {
        // Find the span containing "Last Visit" text, then get next sibling
        const spans = Array.from(document.querySelectorAll('span'));
        const lastVisitLabel = spans.find(el => el.textContent.includes('Last Visit'));
        return lastVisitLabel?.nextElementSibling?.textContent?.trim() || null;
      })(),
      provider: getText('.label-inner-value[title*="DDS"], .label-inner-value[title*="DMD"]')
    };
  });
          logTime('after evaluating patient details from individual page');
    //console.log   Name: ${data.patientName.trim()});
    //console.log   Provider: ${data.provider.trim()});
    //console.log   Last Visit: ${data.lastVisit});
    await page.waitForTimeout(7000);
    //await closePopups(page);
              logTime('after popup');
    const treatmentrows = await openPatientNotes(page, data.lastVisit) || [];
                  logTime('after openPatientNotes');
    //let extraDetails = await extractPatientMedicalAlerts(overviewIframe);
  return {
    patientName: data.patientName?.trim().includes(', ')   ? data.patientName.trim().split(', ').reverse().join(' ')  : data.patientName?.trim(),
    provider: data.provider  ? data.provider.split(",")[0].trim().replace(/-/g, "")  : null,
    lastVisit: data.lastVisit?.trim() === "" ? null : data.lastVisit?.trim(),
    treatmentrows: treatmentrows.length > 0 ? treatmentrows : []
    //alertText: extraDetails?.alertText ?? null,
    //commentText: extraDetails?.commentText ?? null
  };
}


async function openPatientLedger(page, overviewIframe)
{
  await page.click("#MenuBar_LedgerCTB_tbImg");
  // Wait for page to load
  console.log("4. Waiting for ledger to load...");
  
  await page.waitForSelector('#LedgerIframe', { timeout: 5000 })
    .catch(() => console.log("   ⚠️ Ledger iframe not found"));

  // Get the iframe using contentFrame (not frameLocator)
  const ledgerIframeElement = await page.$('#LedgerIframe');
  if (!ledgerIframeElement) 
  {
    console.log("⚠️ Ledger iframe not found");
  } else 
  {
    const ledgerIframe = await ledgerIframeElement.contentFrame();
    if (!ledgerIframe) 
    {
      console.log("⚠️ Cannot access ledger iframe");
    } else 
    {
      // Wait for the table to be visible
      await ledgerIframe.waitForSelector('#accountLedgerTableBody', { state: 'visible', timeout: 500 }).catch(() => console.log("⚠️ Ledger table not found"));
      
      // Give extra time for data to populate
      await page.waitForTimeout(300);
      const targetDate = "01/02/2024";
      console.log(`Looking for date: ${targetDate}`);
      
      // Find all rows
      const matchingRows = await ledgerIframe.evaluate((date) => {
      const rows = document.querySelectorAll('#accountLedgerTableBody tr');
      const results = [];
      
      for (const row of rows)
      {
        const dateLink = row.querySelector('a.date-link');
        if (dateLink && dateLink.textContent.trim() === date) {
          const cells = row.querySelectorAll('td');
          if (cells.length > 12) {
            results.push(cells[10].textContent.trim());
          }
        }
      }
            return results;
      }, targetDate);

      if (matchingRows.length === 0) 
      {
        console.log(`⚠️ No rows found with date ${targetDate}`);
      }
      else 
      {
        console.log(`\n📊 Found ${matchingRows.length} row(s) with date ${targetDate}`);
        //matchingRows.forEach((desc, index) => 
        //{
        //  console.log(`   Row ${index + 1}: ${desc}`);
        //});
      }
    }
  }
}

async function openPatientNotes(page, emergencyDate)
{
  //await page.click("#MenuBar_aImgTplanCTB_tbImg");
  await page.locator('#MenuBar_aImgTplanCTB_tbImg').evaluate(element => element.click());
  console.log("5. Extracting Patient note information...");

  // Wait for the iframe to appear in the DOM
  await page.waitForSelector('#AdvancedTreatPlanQuickEntryIFrame', { state: 'attached', timeout: 10000 });
  
  // Get the iframe using contentFrame (not frameLocator)
  const ledgerIframeElement = await page.$('#AdvancedTreatPlanQuickEntryIFrame');
  
  if (!ledgerIframeElement) 
  {
    console.log("⚠️ #AdvancedTreatPlanQuickEntryIFrame iframe not found");
    return [];
  }
  
  const ledgerIframe = await ledgerIframeElement.contentFrame();
  if (!ledgerIframe) 
  {
    console.log("⚠️ Cannot access #AdvancedTreatPlanQuickEntryIFrame iframe");
    return [];
  }
  
  // Wait for the table to be visible inside the iframe
  await ledgerIframe.waitForSelector('#treatmentplan-data-table-body', { state: 'visible', timeout: 10000 });
  
  // Parse emergency date and calculate date range (1 month before only)
  const emergencyDateObj = new Date(emergencyDate);
  const oneMonthBefore = new Date(emergencyDateObj);
  oneMonthBefore.setMonth(oneMonthBefore.getMonth() - 1);
  
  // Set times to start/end of day for accurate comparison
  oneMonthBefore.setHours(0, 0, 0, 0);
  emergencyDateObj.setHours(23, 59, 59, 999);
  
  console.log(`Looking for dates within 1 month before: ${emergencyDate}`);
  console.log(`Date range: ${oneMonthBefore.toLocaleDateString('en-US')} to ${new Date(emergencyDate).toLocaleDateString('en-US')}`);
  
  // Execute everything in the browser context for maximum speed
  const matchingRows = await ledgerIframe.evaluate(({ oneMonthBeforeTime, emergencyDateTime }) => {
    const rows = document.querySelectorAll('#treatmentplan-data-table-body tr');
    const matches = [];
    const seen = new Set(); // Track unique combinations
    
    for (const row of rows) {
      const dateLink = row.querySelector('a.diag-date');
      if (dateLink) {
        const dateText = dateLink.textContent.trim();
        const rowDate = new Date(dateText);
        rowDate.setHours(0, 0, 0, 0); // Normalize to start of day
        const rowTime = rowDate.getTime();
        
        // Check if the row date is within 1 month before emergency date
        if (rowTime >= oneMonthBeforeTime && rowTime <= emergencyDateTime) {
          const descriptionCell = row.querySelector('td.width-23.text-ellipsis');
          if (descriptionCell) {
            const description = descriptionCell.textContent.trim();
            
            // Create a unique key for this row
            const uniqueKey = `${dateText}|${description}`;
            
            // Only add if we haven't seen this combination before
            if (!seen.has(uniqueKey)) {
              seen.add(uniqueKey);
              matches.push({
                date: dateText,
                description: description
              });
            }
          }
        }
      }
    }
    
    return matches;
  }, { 
    oneMonthBeforeTime: oneMonthBefore.getTime(), 
    emergencyDateTime: emergencyDateObj.getTime()
  });
  
  console.log(`Found ${matchingRows.length} unique rows in ledger table`);
  
  if (matchingRows.length === 0) 
  {
    console.log(`⚠️ No rows found within 1 month before ${emergencyDate}`);
  }
  else 
  {
    console.log(`\n📊 Found ${matchingRows.length} unique row(s) within 1 month before ${emergencyDate}`);
    matchingRows.forEach((row, index) => 
    {
      console.log(`   Row ${index + 1} [${row.date}]: ${row.description}`);
    });
  }
  
  return matchingRows;
}

async function searchDenticonPatient(officeName, patientDoB, firstName, lastName) {
  console.log(`\n--- Starting Run ---`);
  console.log(`Target Patient: ${patientDoB} | Target Office: ${officeName}`);
           logTime('starting browser');

  const browser = await chromium.launch({
    headless: false,
        args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      "--disable-web-security",
      "--disable-features=IsolateOrigins,site-per-process",
    ]
  });

  const context = await browser.newContext();

  const page = await context.newPage();
             logTime('after browser');

  await page.addInitScript(() => {
      const style = document.createElement('style');
      style.innerHTML = `
          #overlay-menubar { display: none !important; pointer-events: none !important; }
          .ui-widget-overlay { display: none !important; }
      `;
      document.head.appendChild(style);
  });
  try {
     // Try to load cookies (should always be available with background refresh)
    //logTime('Check if cookie vald');

    //const savedCookies = await areCookiesValid();
    //logTime('cookie validity checked');

    /*if (savedCookies) {
                console.log('Inside if loop saveld cookies');

      await context.addCookies(savedCookies);
      logTime('Cookies added to context');

      await page.goto('https://a1.denticon.com/aspx/home/advancedmypage.aspx', { 
        waitUntil: 'domcontentloaded',
        timeout: 6000 
      });
      logTime('Navigation to Advanced MyPage complete');

      const redirectLoginSelector = await page.$('#redirectLogin');
      
      if (redirectLoginSelector) {
          console.log('✅ The #redirectLogin selector WAS found.');
      } else {
          console.log('❌ The #redirectLogin selector WAS NOT found.');
      }
      
      if (redirectLoginSelector) {
        console.log('⚠ Cookies failed validation - performing emergency login');
        console.log('⚠ This should rarely happen - check cookie refresh service!');
        await performLogin(page);
        await saveCookies(context);
      } else {
        console.log('✓ Authenticated with background-refreshed cookies');
      }
    } 
    else {
      console.log('⚠ No valid cookies found - this is unusual!');
      console.log('⚠ Check if cookie refresh service is running in server.js');
      
      // Emergency fallback login
      await performLogin(page);
      await saveCookies(context);
    }*/

    await page.goto('https://www.denticon.com/login', { 
    waitUntil: 'load', 
    timeout: 30000 
    });
    
    await page.fill('#loginForm > form > div.form-group > input', 'RecepiaAgent');
    await page.click('#btnLogin');
    
    await page.waitForSelector('input[name="txtPassword"]', { timeout: 10000 });
    await page.fill('input[name="txtPassword"]', 'Dpnr2025$');
    await page.click('#aLogin');
    
    //await page.waitForNavigation({ waitUntil: 'load', timeout: 30000 });
    
    // 2. Select office
    console.log("2. Selecting office...");
    logTime('Waiting for office list');
    await page.waitForSelector('#officeSearchFullList', { state: 'visible' });
    await page.click('#officeSearchFullList');
    
    const listItemSelector = `li.ui-menu-item:has-text("${officeName}")`;
    await page.waitForSelector(listItemSelector, { state: 'visible' });
    await page.click(listItemSelector);
    logTime('Office selection complete');
    console.log(`✅ Office '${officeName}' selected.`);

    // 3. Enter patient name/DOB and search
    console.log("3. Searching for patient...");
    await page.waitForSelector("#MenuBar_txtSearchPat", { state: 'visible', timeout: 6000 });
    await page.fill("#MenuBar_txtSearchPat", patientDoB);
    await page.click("#MenuBar_imgSearchGo");
    logTime('Patient search button clicked');
    
    console.log("5. Determining result type...");

    await page.waitForTimeout(2000);
    const edgeCase = await page.$('#AdvancedTreatPlanQuickEntryIFrame');
    if(edgeCase)
    {
        console.log("Edge case detected - reloading overview page");
        await page.goto('https://a1.denticon.com/ASPX/Patients/AdvancedPatientOverview.aspx', { 
        waitUntil: 'domcontentloaded',
        timeout: 6000 
      });
    }
    
    // Check which iframe is present to determine the result type
    const iframeRace = await Promise.race([
      page.waitForSelector('#AdvancedSearchPatientsIFrame', { state: 'attached', timeout: 10000 })
        .then(() => 'search'),
      page.waitForSelector('#AdvancedPatientOverviewIFrame', { state: 'attached', timeout: 10000 })
        .then(() => 'overview')
    ]).catch(() => null);
    //await page.waitForTimeout(6000); // Give time for iframe to load

    // Check which iframe is present to determine the result type
    //const searchIframe = await page.$('#AdvancedSearchPatientsIFrame');
    //const overviewIframe2 = await page.$('#AdvancedPatientOverviewIFrame');

        logTime('iframe200 finished');

    
    // CASE 1: Multiple patients found (AdvancedSearchPatientsIFrame)
    if (iframeRace === 'search') {
      //console.log("   📋 Multiple patients found - accessing search results...");
      
      const searchIframe = await page.$('#AdvancedSearchPatientsIFrame');
      const iframe = await searchIframe.contentFrame();
      if (!iframe) {
        throw new Error("Cannot access search results iframe");
      }
      
      const result = await Promise.race([
        iframe.waitForSelector('#search-patients-data-table tr[patid]', { 
          state: 'visible',
          timeout: 10000 
        }).then(() => 'found'),
        iframe.waitForSelector('td.dataTables_empty', { 
          state: 'visible',
          timeout: 10000 
          }).then(() => 'empty')
      ]).catch(() => 'timeout');
    
      if (result === 'empty') {
        console.log(" ⚠️ No matching records found");
        await context.close();
        return { status: "not_found",
          message: "No matching patient found with given name"};
      }
              console.log("result:", result);

      if (result === 'timeout') {
        throw new Error("Search results did not load in time");
      }
      //console.log(" ✅ Search results table loaded");
      // Count the number of patient rows
                    logTime('before extracting patient info from table');

      const patients = await iframe.evaluate(() => {
        const rows = document.querySelectorAll('#search-patients-data-table tr.search-patients-div-row');
        return Array.from(rows).slice(0, 10).map((row, index) => ({
          index,
          patid: row.getAttribute('patid'),
          text: row.textContent?.trim().substring(0, 100)
        }));
      });
              logTime('extracted patient info from table');

      const rowCount = patients.length;
      console.log(`   ✅ Found ${rowCount} patient(s) in search results`);
      
      console.log("\n   Sample patients:");
      patients.forEach((p, idx) => {
        console.log(`   ${idx + 1}. PatID: ${p.patid}   ${p.text}`);
      });

      //console.log(patientExists(patients, firstName, lastName));
      logTime('calling patientExists');

      const patient2 = patientExists(patients, firstName, lastName);
      if(!patient2)
      {
        console.log("⚠️ No matching patient found with given name");
        await context.close();
        return {
          status: "not_found",
          message: "No matching patient found with given name"
        };
      }
      logTime('received patientExists');

      let matchingRowSelector;
      
      if (patient2) 
      {
        console.log("Found at row:", patient2.index);
        console.log("Patient ID:", patient2.patid);
        matchingRowSelector = `#search-patients-data-table tr.search-patients-div-row[patid="${patient2.patid}"]`;
      }

      console.log("matchingRowSelector...",matchingRowSelector);

      logTime('clicked matching row');
      await Promise.all([
      iframe.click(matchingRowSelector),
      page.waitForSelector('#AdvancedPatientOverviewIFrame', { 
        state: 'attached', 
        timeout: 10000 
        })
      ]);

      
      console.log("3. Waiting for patient overview to load...");
      // Wait for the patient overview iframe

      const overviewIframeElement = await page.$('#AdvancedPatientOverviewIFrame');
      if (!overviewIframeElement) {
        await context.close();
        return {
          status: "error",
          message: "Patient overview iframe not found after clicking row"
        };
      }

      const overviewIframe = await overviewIframeElement.contentFrame();
      if (!overviewIframe) {
        await context.close();
        return {
          status: "error",
          message: "Cannot access patient overview iframe"
        };
      }

      logTime('sending to extractPatientDetails');      
      const patientDetails = await extractPatientDetails(overviewIframe, page);
      await context.close();
      
      logTime('all done');
      return patientDetails;
    }
    
    // CASE 2: Single patient found (AdvancedPatientOverviewIFrame)#AdvancedPatientOverviewIFrame
    else if (iframeRace === 'overview') 
    {
      console.log("   👤 Single patient found2 - extracting details...");

      const overviewIframe = await page.$('#AdvancedPatientOverviewIFrame');
      const iframe = await overviewIframe.contentFrame();
      
      if (!iframe) 
      {
        throw new Error("Cannot access patient overview iframe");
      }
      
      // Wait for the patient-name element to load
      await iframe.waitForSelector('.patient-name', { 
        state: 'visible', 
        timeout: 7000 
      });
            console.log("   before sending ");

      const patientDetails = await extractPatientDetails(iframe,page);

      await context.close();
      return patientDetails;
    }
    

  } 
  catch (error) 
  {
    console.error("\n❌ Error occurred:", error.message);
    console.error(error.stack);
    
    // Take error screenshot
    try {
      await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
      console.log("📸 Error screenshot saved: error-screenshot.png");
    } catch (e) {
      console.log("Could not save error screenshot");
    }
    
    await context.close();
    
    return {
      status: "error",
      message: error.message
    };
  }
}

export { searchDenticonPatient };



const a = await searchDenticonPatient("Suave Dental Stockton [102] ", "04/19/1970", "Xufang", "Lian").then(console.log);  //zero results
const b = await searchDenticonPatient("Suave Dental West Sacramento [106] ", "11/01/1977", "Lisa", "Chaney").then(console.log);  //zero results

























