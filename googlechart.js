var utils = require('./utils');

function GoogleChart(width, height) {
  this.width = width;
  this.height = height;
}

/**
 * Change the scale of data if it has small values so the chart can show it more accurately. 
 * Returns the scaled values and some data about the scale.
 */
function scaleData(values) {
  var scaleFactor = values[0] > 10 ? 1 : 1000;
  var data = [];
  var min = Number.MAX_SAFE_INTEGER;
  var max = 0;
  for(var i = 0; i <= values.length; i++) { 
      var value = utils.round(values[i] * scaleFactor, 0);
      if(value) {
      data.push(value);
      if (value < min) {
          min = value;
      }
      if (value > max) {
          max = value;
      }
      }
  }
  max = Math.floor(max * 1.1);
  return {
    data: data,
    scaleFactor: scaleFactor,
    min: min,
    max: max
  };
}

/**
 * Generate labels for the y axis based on the scale factor.
 * Scaled data won't show the right values otherwise.
 */
function generateAxisLabels(max, scaleFactor) {
  var yAxisLabels = [];
  var skipCount = max / 5;
  for(var j = 0; j <= max; j += skipCount) {
      yAxisLabels.push(utils.round(j / scaleFactor, 3));
  }
  return yAxisLabels;
}

/**
 * Build a google charts URL for the given data.
 */
GoogleChart.prototype.buildUrl = function(values, metricName, start, end) {
  var scaledValues = scaleData(values);
  var baseUrl = 'https://chart.googleapis.com/chart?';
  var options = 'cht=lc&chs=' + this.width + 'x' + this.height + '&chxt=r,x&chf=bg,s,00000000';
  var scale = '&chxr=0,0,' + scaledValues.max + '&chds=0,' + scaledValues.max;
  var labels = '&chxl=1:|' + start + '|' + end + '|0:|' + generateAxisLabels(scaledValues.max, scaledValues.scaleFactor).join('|');
  var dataString = '&chd=t:' + scaledValues.data.join(',');
  var url = baseUrl + options + scale + labels + dataString;
  return encodeURI(url);
};

module.exports = GoogleChart;
