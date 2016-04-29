function BotData(controller) {
  this.controller = controller;
}

/**
 * Gets data for a channel for a specific user.
 * @param {string} user - the id of the user the data is for
 * @param {string} channel - the id of the channel the data is for 
 * @returns {Promise} - a promise that will be fulfilled by the data
 */
BotData.prototype.getUserChannelData = function(user, channel) {
  var self = this;
  return new Promise(function(fulfill, reject) {
    self.controller.storage.users.get(user, function(err, userData) {
      if(err) {
        reject(err);
      } else if(!userData || !userData.channels[channel]) {
        // TODO: for some reason the debugger breaks the 2nd time it hits this line
        reject(new Error("no channel data"));
      } else {
        fulfill(userData.channels[channel]);
      }
    });
  });
};

/**
 * Saves data for a channel for a specific user.
 * @param {string} user - the id of the user the data is for
 * @param {string} channel - the id of the channel the data is for 
 * @param {string} userChannelData - the data to be saved for this user/channel combo 
 * @returns {Promise} - a promise that returns no data
 */
BotData.prototype.saveUserChannelData = function(user, channel, userChannelData, shouldMerge) {
  var merge = shouldMerge === undefined || shouldMerge;
 
  var self = this;
  userChannelData.id = channel;
  // First get the user's data
  return new Promise(function(fulfill, reject) {
    self.controller.storage.users.get(user, function(err, userData) {
      if(err || !userData) {
        userData = { id: user };
      }
      if(!userData.channels) {
        userData.channels = {};
      }
      fulfill(userData);
    });
  }).then(function(userData) {
    var data = {};
    if(merge) {
      // Now merge the new channel data in and save
      // Merging so different functionality can store different data without overwriting
      data = userData.channels[channel] || {};
      Object.assign(data, userChannelData);
    } else {
      // To delete you need to overwrite, so support that too
      data = userChannelData;
    }
    userData.channels[channel] = data;
    
    self.controller.storage.users.save(userData, function(err) { 
      if(err) {
        console.error('Error saving user data:', err);
      } 
    });
  });
};

BotData.prototype.getAllUserData = function() {
  var self = this;
  return new Promise(function(fulfill, reject) {
    self.controller.storage.users.all(function(err, result) {
      if(err) {
        reject(err);
      } else {
        fulfill(result);
      }
    });
  });
};

/**
 * Fetch the identity information for a specific bot. Stashes the icon url
 * in `bot.identity.icon`.
 * 
 * @param {*} bot - the bot to fetch the identity for
 */
BotData.prototype.fetchBotIdentity = function(bot) {
  bot.api.users.info({ user: bot.identity.id }, function(err, result) {
    bot.identity.icon = result.user.profile.image_original;
  });
};

BotData.prototype.fetchUserInfo = function(user, bot) {
  return new Promise(function(fulfill, reject) {  
    bot.api.users.info({ user: user }, function(err, result) {
      if(err) {
        reject(err);
      } else {
        fulfill(result);
      }
    });
  });
};

module.exports = BotData;
