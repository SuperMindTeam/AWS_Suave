import express from "express";
import cors from "cors";
import { searchDenticonPatient } from "./second.js";
import { execSync } from 'child_process';

const app = express();
app.use(express.json());
app.use(cors());

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

// Debug endpoint
app.get("/debug", (req, res) => {
  try {
    const playwrightVersion = execSync('npx playwright --version').toString();
    const browserPath = process.env.PLAYWRIGHT_BROWSERS_PATH || 'not set';
    const msPlaywrightExists = execSync('ls -la /ms-playwright/ 2>&1').toString();
    
    res.json({
      playwrightVersion,
      browserPath,
      msPlaywrightExists
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.post("/lookup", async (req, res) => {
  const startTime = Date.now();
  console.log('=== LOOKUP REQUEST RECEIVED ===');
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    let suaveBranch, dob, firstName, lastName;
    
    // Check if this is a VAPI tool call format
    if (req.body.message && req.body.message.toolCalls) {
      console.log('VAPI format detected');
      const toolCall = req.body.message.toolCalls[0];
      const args = toolCall.function.arguments;
      
      suaveBranch = args.suaveBranch;
      dob = args.dob;
      firstName = args.firstName;
      lastName = args.lastName;
    } 
    // Direct format (for manual testing)
    else {
      console.log('Direct format detected');
      suaveBranch = req.body.suaveBranch;
      dob = req.body.dob;
      firstName = req.body.firstName;
      lastName = req.body.lastName;
    }
    
    console.log('Extracted params:', { suaveBranch, firstName, lastName, dob });


    
    if (!suaveBranch || !firstName || !lastName || !dob) {
      console.log('Missing required fields');
      return res.status(200).json({ 
        error: "Missing required fields",
        message: "Please provide suaveBranch, firstName, lastName, and dob"
      });
    }
    
    // Normalize the branch name
    const normalizedBranch = normalizeBranchName(suaveBranch);
    console.log(`Branch mapping: "${suaveBranch}" -> "${normalizedBranch}"`);
    
    console.log('Calling searchDenticonPatient...');
    const data = await searchDenticonPatient(normalizedBranch, dob, firstName, lastName);
    const duration = Date.now() - startTime;
    console.log(`Patient data received in ${duration}ms:`, data);

    console.log('Patient data received:', JSON.stringify(data, null, 2));
    
    // Format response for VAPI
    const response = {
      PatientName: data.patientName || "No patient record found",
      DoctorName: data.provider || "N/A",
      PatientLastVisit: data.lastVisit || "N/A",
      treatmentrows: data.treatmentrows?.length ? data.treatmentrows : "N/A"
      //commentText: data.commentText || "No comments",
    };
    
    console.log('Sending response:', JSON.stringify(response, null, 2));
    
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
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});











