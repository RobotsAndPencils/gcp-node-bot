var Utils = require('./utils');

function GoogleChart(width, height) {
  this.width = width;
  this.height = height;
  this.data = [];
}

/**
 * Calculate the min, max and scaleFactor for the set of series.
 * The scale factor is usually 1, unless the max is < 10.
 */
function findScaleValues(data) {
  var min = Number.MAX_SAFE_INTEGER;
  var max = 0;
  var start = '';
  var end = '';
  for(var i = 0; i < data.length; i++) {
    var series = data[i].values;
    // Assume the start and end are the same for all series
    start = data[i].start;
    end = data[i].end;
    for(var j = 0; j <= series.length; j++) {
      var value = series[j];
      if(value) {
        if (value < min) {
          min = value;
        }
        if (value > max) {
          max = value;
        }
      }
    }
  }
  // Calculate the scale factor based on the max
  var scaleFactor = max > 10 ? 1 : 1000;
  
  return {
    min: min,
    max: max,
    start: start,
    end: end,
    scaleFactor: scaleFactor
  };
}

/**
 * Produce a function that will scale values according to a certain factor.
 */
function scaleFunction(scaleFactor) {
  return function(value) {
    return Utils.round(value * scaleFactor, 0);
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
      yAxisLabels.push(Utils.round(j / scaleFactor, 3));
  }
  return yAxisLabels;
}

/**
 * Add data to the chart, each time you call this it will add a new series.
 * 
 * @param {[Number]} values - the actual values
 */
GoogleChart.prototype.addData = function(values, label, start, end) {
  this.data.push({
    values: values,
    label: label,
    start: start,
    end: end
  });
};

/**
 * Build a string representing each series
 */
function buildDataString(data, scaleFunction) {
  var output = '';
  for(var i = 0; i < data.length; i++) {
    var series = data[i];
    if(i > 0) {
      output += '|';
    }
    output += series.values.map(scaleFunction).join(',');
  }
  return output;
}

/**
 * Build labels for each series
 */
function buildSeriesLabels(data) {
  var output = '';
  for(var i = 0; i < data.length; i++) {
    if(i > 0) {
      output += '|';
    }
    output += data[i].label;
  }
  return output;
}

/**
 * Build a google charts URL for the given data.
 */
GoogleChart.prototype.buildUrl = function() {
  var scaleValues = findScaleValues(this.data);
  var scaledMax = Math.floor(scaleValues.max * scaleValues.scaleFactor * 1.1); // Adjust the max to give the chart a bit of room
  var baseUrl = 'https://chart.googleapis.com/chart?';
  var options = 'cht=lc&chs=' + this.width + 'x' + this.height + '&chxt=r,x&chf=bg,s,00000000';
  var legend = '&chco=FF0000,00FF00,0000FF&chdlp=b&chdl=' + buildSeriesLabels(this.data);
  var scale = '&chxr=0,0,' + scaledMax + '&chds=0,' + scaledMax;
  var labels = '&chxl=1:|' + scaleValues.start + '|' + scaleValues.end + '|0:|' + generateAxisLabels(scaledMax, scaleValues.scaleFactor).join('|');
  var dataString = '&chd=t:' + buildDataString(this.data, scaleFunction(scaleValues.scaleFactor));
  var url = baseUrl + options + legend + scale + labels + dataString;
  console.log('chart url length:', url.length);
  return encodeURI(url);
};

module.exports = GoogleChart;