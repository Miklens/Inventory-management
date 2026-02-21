/**
 * Firebase config – edit this file ONCE.
 * 1. Open Firebase Console → your project → Project Settings (gear) → Your apps.
 * 2. Copy the config object (or the values below) and paste here.
 * 3. Save. All users of this app will use this config – no one else needs to add keys.
 */
(function (global) {
  'use strict';
  var config = {
    apiKey: 'AIzaSyCGtpOz22s23ncYgIuuhP4JeaUS1_iKW3A',
    authDomain: 'inventory-management-d2ace.firebaseapp.com',
    projectId: 'inventory-management-d2ace',
    storageBucket: 'inventory-management-d2ace.firebasestorage.app',
    messagingSenderId: '79940113871',
    appId: '1:79940113871:web:fbf769a8ca5999e6296eba'
  };
  if (typeof global !== 'undefined') global.FIREBASE_CONFIG = config;
  if (typeof window !== 'undefined') window.FIREBASE_CONFIG = config;
})(typeof window !== 'undefined' ? window : this);
