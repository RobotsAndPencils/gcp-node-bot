function BotData(controller) {
  this.controller = controller;
}

/**
 * Gets data for a specific team.
 * @param {string} team - the id of the team the data is for
 * @returns {Promise} - a promise that will be fulfilled by the data
 */
BotData.prototype.getTeamData = function(team) {
  var self = this;
  return new Promise(function(fulfill, reject) {
    self.controller.storage.teams.get(team, function(err, teamData) {
      // Ignore error because it's usually just because the data is not there
      if(err || !teamData) {
        fulfill({ id: team });
      } else {
        fulfill(teamData);
      }
    });
  });
};

/**
 * Saves data for a specific team.
 * @param {string} team - the id of the team the data is for
 * @param {string} teamData - the data to be saved for this team
 * @returns {Promise} - a promise that returns no data
 */
BotData.prototype.saveTeamData = function(team, teamData) {
  var self = this;
  teamData.id = team;
  // First get the user's data
  return this.getTeamData(team).then(function(existingData) {
    var data = existingData;
    Object.assign(data, teamData);
    self.controller.storage.teams.save(data, function(err) { 
      if(err) {
        console.error('Error saving team data:', err);
        return Promise.reject(err);
      }
    });
  });
};


/**
 * Gets data for a specific user.
 * @param {string} user - the id of the user the data is for
 * @returns {Promise} - a promise that will be fulfilled by the data
 */
BotData.prototype.getUserData = function(user) {
  var self = this;
  return new Promise(function(fulfill, reject) {
    self.controller.storage.users.get(user, function(err, userData) {
      // Ignore error because it's usually just because the data is not there
      if(err || !userData) {
        fulfill({ id: user });
      } else {
        fulfill(userData);
      }
    });
  });
};

/**
 * Gets data for a channel for a specific user.
 * @param {string} user - the id of the user the data is for
 * @param {string} channel - the id of the channel the data is for 
 * @returns {Promise} - a promise that will be fulfilled by the data
 */
BotData.prototype.getUserChannelData = function(user, channel) {
  var self = this;
  return this.getUserData(user).then(function(userData) {
    if(!userData || !userData.channels || !userData.channels[channel]) {
      return Promise.resolve({});
    } else {
      return userData.channels[channel];
    }
  });
};

/**
 * Saves data for a specific user.
 * @param {string} user - the id of the user the data is for
 * @param {string} userData - the data to be saved for this user
 * @returns {Promise} - a promise that returns no data
 */
BotData.prototype.saveUserData = function(user, userData, shouldMerge) {
  var merge = shouldMerge === undefined || shouldMerge;
 
  var self = this;
  userData.id = user;
  // First get the user's data
  return this.getUserData(user).then(function(existingData) {
    var data = existingData;
    if(merge) {
      // Merging so different functionality can store different data without overwriting
      Object.assign(data, userData);
    } else {
      // To delete you need to overwrite, so support that too
      data = userData;
    }
    self.controller.storage.users.save(data, function(err) { 
      if(err) {
        console.error('Error saving user data:', err);
        return Promise.reject(err);
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
  return this.getUserData(user).then(function(userData) {
    var data = {};
    if(!userData.channels) {
      userData.channels = {};
    }
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

/**
 * Fetch the data for all users.
 */
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
 * Fetch the identity information for a specific user.
 * 
 * @param {*} bot - the bot to fetch the identity for
 */
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

/**
 * Fetch the identity information for a specific bot. Stashes the icon url
 * in `bot.identity.icon`.
 * 
 * @param {*} bot - the bot
 * @param {*} id - the id of the bot
 */
BotData.prototype.fetchBotIdentity = function(bot, id) {
  bot.api.users.info({ user: id }, function(err, result) {
    if(!bot.config) {
      bot.config = {};
    }
    if(result.user && result.user.profile) {
      bot.config.icon_url = result.user.profile.image_original;
    } else {
      console.error("user profile missing for: " + id)
    }
  });
};

module.exports = BotData;
