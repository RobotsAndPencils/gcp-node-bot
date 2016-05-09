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
var slackToken = process.env.SLACK_TOKEN; // not required, defaults to connecting BeepBoop resourcer
var googleClientId = requireEnvVariable('GOOGLE_CLIENT_ID');
var googleClientSecret = requireEnvVariable('GOOGLE_CLIENT_SECRET');
var firebase_uri = process.env.FIREBASE_URI; // not required, defaults to JSON store
var firebaseSecret = process.env.FIREBASE_SECRET; // not required, defaults to no auth on firebase
var port = process.env.PORT || 3000; // not required, default to 3000
var oauthRedirectUrl = process.env.OAUTH_REDIRECT_URL || 'http://localhost:' + port + '/auth'; // not required, default to localhost
// If ALL of the beep boop values are defined, don't use the slack token.
if(process.env.BEEPBOOP_ID && process.env.BEEPBOOP_RESOURCER && process.env.BEEPBOOP_TOKEN) {
  slackToken = undefined;
} else if(!slackToken) {
  throw new Error('Either SLACK_TOKEN or BeepBoop variables (BEEPBOOP_ID, BEEPBOOP_RESOURCER and BEEPBOOP_TOKEN) are required!');
}

var botkitOptions = { retry: true };
if (firebase_uri) {
  var firebaseStorage = require('botkit-storage-firebase');
  botkitOptions.storage = firebaseStorage({ firebase_uri: firebase_uri });;
  // If the firebase secret is passed, authenticate firebase
  if(firebaseSecret) {
    var FirebaseTokenGenerator = require("firebase-token-generator");
    var tokenGenerator = new FirebaseTokenGenerator(firebaseSecret);
    var token = tokenGenerator.createToken({ uid: "1" }, { admin: true });
    botkitOptions.storage.firebase.authWithCustomToken(token, function(error, authData) {
      if (error) {
        console.log("Firebase Login Failed!", error);
      } else {
        console.log("Firebase Login Succeeded!");
      }
    });
  }
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
var bots = gcpbot(controller, botData, authCache, slackToken);

var app = express();
app.get('/auth', function(req, res) {
  console.log('request at /auth');
  
  var code = req.query.code;
  if(!code) {
    console.error('No code in auth request', req.query.state);
    res.send('Missing authentication code. You have not been authenticated.');
    return;
  }
  // Use the CSRF token to look up which user this is
  var user = authCache.lookupUser(req.query.state);
  if(!user) {
    console.error('User not found for state', req.query.state);
    res.send('This appears to be an old login url. You have not been authenticated.');
    return;
  }
  // Now find their auth data
  authCache.lookupAuth(user).then(function(auth) {
    if(auth && auth.client) {
      var oauth2Client = auth.client;
      // Use the auth data to get the tokens and put them in the client
      oauth2Client.getToken(code, function(err, tokens) {
        if(!err) {
          oauth2Client.setCredentials(tokens);
          auth.tokens = tokens;
          authCache.saveAuth(auth);
          // Send the user a private message saying it was successful
          var bot = bots[auth.teamId];
          bot.api.im.open({user: user}, function (err, response) {
            if(err) { console.error(err); }
            bot.say({ text: "🔑 Success! Authorization complete.", channel: response.channel.id });
          });
        } else {
          console.log('error authorizing...', err);
        }
      });
      res.send('Thank you. You have been authenticated. You may close this page.');
    } else {
      console.error('requesting auth for user with no client...', user);
      res.send('There was a problem trying to authenticate you. Try again?');
    }
  });
});

app.listen(port, function () {
  console.log('GCPBot listening on port:', port);
});
