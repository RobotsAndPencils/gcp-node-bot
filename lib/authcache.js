var google = require('googleapis');

function AuthCache(defaults) {
  this.cache = {};
  this.defaults = defaults;
}

AuthCache.prototype.lookupAuth = function(user) {
  var auth = this.cache[user];
  if(!auth) {
    auth = { user: user };
  } 
  return auth;
};

AuthCache.prototype.createAuth = function(user) {
  var auth = this.lookupAuth(user);
  auth.client = new google.auth.OAuth2(this.defaults.googleClientId, this.defaults.googleClientSecret, this.defaults.oauthRedirectUrl);
  this.cache[user] = auth;
  return auth;
};

AuthCache.prototype.generateAuthUrl = function(user) {
  var auth = this.createAuth(user);
  var scopes = [
    'https://www.googleapis.com/auth/ndev.cloudman',
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/monitoring',
  ];
  return auth.client.generateAuthUrl({ access_type: 'offline',  scope: scopes, state: user });
};

AuthCache.prototype.saveAuth = function(auth) {
  this.cache[auth.user] = auth;
};

module.exports = AuthCache;
