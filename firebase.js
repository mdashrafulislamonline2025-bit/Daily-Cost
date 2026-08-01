/* =========================================================================
   firebase.js
   -------------------------------------------------------------------------
   Central Firebase setup for Expense Manager.
   Uses the Firebase v10 modular SDK, loaded directly from the CDN as
   ES Modules, so this file (and every page that imports it) must be
   loaded with <script type="module"> ... </script>.

   >>> REPLACE firebaseConfig BELOW WITH YOUR OWN PROJECT CREDENTIALS <<<
   You can find these values in:
   Firebase Console → Project Settings → General → Your apps → SDK setup
   ========================================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  getDocs,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// -------------------------------------------------------------------------
// 1. Your Firebase project configuration
// -------------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

// -------------------------------------------------------------------------
// 2. Initialize Firebase services
// -------------------------------------------------------------------------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// -------------------------------------------------------------------------
// 3. Re-export everything the rest of the app needs, from one place.
//    Every page imports from "./firebase.js" only.
// -------------------------------------------------------------------------
export {
  app,
  auth,
  db,
  storage,
  // auth helpers
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  // firestore helpers
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  getDocs,
  writeBatch,
  // storage helpers
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
};
