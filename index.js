var Botkit = require('botkit');
var firebaseStorage = require('botkit-storage-firebase');
var google = require('googleapis');
var gcpbot = require('./lib/bot.js');

function requireEnvVariable(name) {
  var value = process.env[name];
  if(!value) {
    throw new Error(name + ' is required!');
  }
  return value;
}

// Expect a bunch of environment variables
var slackToken = requireEnvVariable('SLACK_TOKEN');
var private_key = requireEnvVariable('PRIVATE_KEY');
var client_email = requireEnvVariable('CLIENT_EMAIL');
var firebase_uri = process.env.FIREBASE_URI; // not required, defaults to JSON store

var jwtClient = new google.auth.JWT(client_email, null, private_key,
  [
    'https://www.googleapis.com/auth/ndev.cloudman',
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/monitoring',
  ], null);

var botkitOptions = { retry: true };
if (firebase_uri) {
  botkitOptions.storage = firebaseStorage({ firebase_uri: firebase_uri });
} else {
  botkitOptions.json_file_store = './userdata/';
}
var controller = Botkit.slackbot(botkitOptions);
gcpbot(controller, slackToken);

//https://beepboophq.com/proxy/<id>/auth
