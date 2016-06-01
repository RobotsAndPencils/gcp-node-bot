module.exports = {
    round: function (value, decimals) {
      return Number(Math.round(value+'e'+decimals)+'e-'+decimals);
    },
    
    formatDate: function(date) {
      return date.toISOString().replace(/T/, ' ').replace(/\..+/, '');
    },
    
    calculateIntervalLength: function(startDate, endDate, intervalCount) {
        return this.round((endDate - startDate) / 1000 / intervalCount, 3);
    },
   
    getResponseText: function(bot, response) {
      var responseText = response.text;
      // Remove any @mention of this bot
      responseText = responseText.replace(new RegExp('<@' + bot.identity.id + '>(:)?'), '');
      return responseText.trim();
    },
    
    cleanupQuotes: function(string) {
      if(!string) {
        return string;
      }
      return string.replace(/“/g, '"').replace(/”/g, '"').replace(/‘/g, "'").replace(/’/g, "'");
    },
};
