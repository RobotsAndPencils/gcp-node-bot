var Botkit = require('botkit');
var express = require('express');
var google = require('googleapis');
var AuthCache = require('./lib/authcache.js');
var BotData = require('./lib/botdata');
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
var googleClientId = requireEnvVariable('GOOGLE_CLIENT_ID');
var googleClientSecret = requireEnvVariable('GOOGLE_CLIENT_SECRET');
var firebase_uri = process.env.FIREBASE_URI; // not required, defaults to JSON store
var port = process.env.PORT || 3000; // not required, default to 3000
var oauthRedirectUrl = process.env.OAUTH_REDIRECT_URL || 'http://localhost:' + port + '/auth'; // not required, default to localhost

var botkitOptions = { retry: true };
if (firebase_uri) {
  var firebaseStorage = require('botkit-storage-firebase');
  botkitOptions.storage = firebaseStorage({ firebase_uri: firebase_uri });
} else {
  botkitOptions.json_file_store = './userdata/';
}
var controller = Botkit.slackbot(botkitOptions);
var botData = new BotData(controller);
var authCache = new AuthCache(botData, { 
  googleClientId: googleClientId, 
  googleClientSecret: googleClientSecret, 
  oauthRedirectUrl: oauthRedirectUrl 
});
gcpbot(controller, slackToken, botData, authCache);

var app = express();
app.get('/auth', function(req, res) {
  console.log('request at /auth');
  
  var user = req.query.state;
  authCache.lookupAuth(user).then(function(auth) {
    if(auth && auth.client) {
      var oauth2Client = auth.client;
      oauth2Client.getToken(req.query.code, function(err, tokens) {
        if(!err) {
          oauth2Client.setCredentials(tokens);
          auth.tokens = tokens;
          authCache.saveAuth(auth);
        } else {
          console.log('error authorizing...', err);
        }
      });
      res.send('You have been authenticated...');
    } else {
      console.error('requesting auth for user with no client...', user);
      res.send('There was a problem trying to authenticate you.');
    }
  });
});

app.listen(port, function () {
  console.log('GCPBot listening on port:', port);
});
