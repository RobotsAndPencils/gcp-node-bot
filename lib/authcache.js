var google = require('googleapis');
var Tokens = require('csrf');

var tokens = new Tokens();
var csrfSecret = tokens.secretSync();
function AuthCache(botData, defaults) {
  this.cache = {};
  this.csrfTokens = {};
  this.botData = botData;
  this.defaults = defaults;
}

AuthCache.prototype.lookupUser = function(token) {
  var user = this.csrfTokens[token];
  delete this.csrfTokens[token];
  return user;
};

AuthCache.prototype.lookupAuth = function(user) {
  var auth = this.cache[user];
  if(auth) {
    return Promise.resolve(auth);
  }
  
  var defaults = this.defaults;
  return this.botData.getUserData(user).then(function(userData) {
    var auth = { user: user };
    if(userData.auth && userData.auth.tokens) {
      auth.client = new google.auth.OAuth2(defaults.googleClientId, defaults.googleClientSecret, defaults.oauthRedirectUrl);
      auth.client.setCredentials(userData.auth.tokens);
      auth.tokens = userData.auth.tokens;
    }
    return auth;
  });
};

AuthCache.prototype.createAuth = function(user) {
  var self = this;
  return this.lookupAuth(user).then(function(auth) {
    auth.client = new google.auth.OAuth2(self.defaults.googleClientId, self.defaults.googleClientSecret, self.defaults.oauthRedirectUrl);
    self.cache[user] = auth;
    return auth;
  });
};

AuthCache.prototype.generateAuthUrl = function(user) {
  var self = this;
  return this.createAuth(user).then(function(auth) {
    var scopes = [
      'https://www.googleapis.com/auth/ndev.cloudman',
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/monitoring',
    ];
    var csrfToken = tokens.create(csrfSecret);
    self.csrfTokens[csrfToken] = user;
    return auth.client.generateAuthUrl({ access_type: 'offline',  scope: scopes, state: csrfToken});
  });
};

AuthCache.prototype.saveAuth = function(auth) {
  var userData = {
    auth: {
      tokens: auth.tokens
    }
  };
  this.botData.saveUserData(auth.user, userData);
  this.cache[auth.user] = auth;
};

module.exports = AuthCache;
