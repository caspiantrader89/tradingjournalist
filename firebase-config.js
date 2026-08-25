/* =========================================================
   FIREBASE CONFIG
   Incolla qui i valori che trovi in:
   Firebase Console → ⚙️ Impostazioni progetto → Generale
   → "Le tue app" → app web → SDK setup and configuration
   ========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyCRvhDmngdwv2R_3fC1ToIC7-q6hSUb4M4",
  authDomain: "tradingjournalist-be88b.firebaseapp.com",
  projectId: "tradingjournalist-be88b",
  storageBucket: "tradingjournalist-be88b.firebasestorage.app",
  messagingSenderId: "434255860675",
  appId: "1:434255860675:web:94693e7ea4bbdad4992376"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Persistenza login: resta collegato anche chiudendo il browser
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(console.warn);
