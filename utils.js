module.exports = {
    round: function (value, decimals) {
        return Number(Math.round(value+'e'+decimals)+'e-'+decimals);
    }
};
