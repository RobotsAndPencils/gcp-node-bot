module.exports = {
    round: function (value, decimals) {
      return Number(Math.round(value+'e'+decimals)+'e-'+decimals);
    },
    
    formatDate: function(date) {
      return date.toISOString().replace(/T/, ' ').replace(/\..+/, '');
    },
    
    calculateIntervalLength: function(startDate, endDate, intervalCount) {
        return this.round((endDate - startDate) / 1000 / intervalCount, 3);
    }
};