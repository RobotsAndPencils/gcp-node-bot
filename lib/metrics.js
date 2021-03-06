var packageData = {
    getPackageList: function() {
        return Object.keys(this.packages);
    },
    
    packages: {
        'compute': { metrics: [
            'compute.googleapis.com/firewall/dropped_bytes_count',
            'compute.googleapis.com/firewall/dropped_packets_count',
            'compute.googleapis.com/instance/cpu/reserved_cores',
            'compute.googleapis.com/instance/cpu/usage_time',
            'compute.googleapis.com/instance/cpu/utilization',
            'compute.googleapis.com/instance/disk/read_bytes_count',
            'compute.googleapis.com/instance/disk/read_ops_count',
            'compute.googleapis.com/instance/disk/throttled_read_bytes_count',
            'compute.googleapis.com/instance/disk/throttled_read_ops_count',
            'compute.googleapis.com/instance/disk/throttled_write_bytes_count',
            'compute.googleapis.com/instance/disk/throttled_write_ops_count',
            'compute.googleapis.com/instance/disk/write_bytes_count',
            'compute.googleapis.com/instance/disk/write_ops_count',
            'compute.googleapis.com/instance/network/received_bytes_count',
            'compute.googleapis.com/instance/network/received_packets_count',
            'compute.googleapis.com/instance/network/sent_bytes_count',
            'compute.googleapis.com/instance/network/sent_packets_count',
            'compute.googleapis.com/instance/uptime',
        ]},
        'cpu': { metrics: [
            'appengine.googleapis.com/system/cpu/usage',
            'compute.googleapis.com/instance/cpu/reserved_cores',
            'compute.googleapis.com/instance/cpu/usage_time',
            'compute.googleapis.com/instance/cpu/utilization',
            'container.googleapis.com/container/cpu/reserved_cores',
            'container.googleapis.com/container/cpu/usage_time',
            'container.googleapis.com/container/cpu/utilization',
        ]},
        'instance': { metrics: [
            'appengine.googleapis.com/system/instance_count',
            'appengine.googleapis.com/system/memory/usage',
            'cloudsql.googleapis.com/database/mysql/replication/available_for_failover',
            'cloudsql.googleapis.com/database/network/connections',
            'cloudsql.googleapis.com/database/state',
            'cloudsql.googleapis.com/database/up',
            'cloudsql.googleapis.com/database/uptime',
            'compute.googleapis.com/firewall/dropped_bytes_count',
            'compute.googleapis.com/firewall/dropped_packets_count',
            'compute.googleapis.com/instance/cpu/reserved_cores',
            'compute.googleapis.com/instance/cpu/usage_time',
            'compute.googleapis.com/instance/cpu/utilization',
            'compute.googleapis.com/instance/disk/read_bytes_count',
            'compute.googleapis.com/instance/disk/read_ops_count',
            'compute.googleapis.com/instance/disk/throttled_read_bytes_count',
            'compute.googleapis.com/instance/disk/throttled_read_ops_count',
            'compute.googleapis.com/instance/disk/throttled_write_bytes_count',
            'compute.googleapis.com/instance/disk/throttled_write_ops_count',
            'compute.googleapis.com/instance/disk/write_bytes_count',
            'compute.googleapis.com/instance/disk/write_ops_count',
            'compute.googleapis.com/instance/network/received_bytes_count',
            'compute.googleapis.com/instance/network/received_packets_count',
            'compute.googleapis.com/instance/network/sent_bytes_count',
            'compute.googleapis.com/instance/network/sent_packets_count',
            'compute.googleapis.com/instance/uptime',
        ]},
        'simple': { metrics: [
            'compute.googleapis.com/instance/cpu/usage_time',
            'compute.googleapis.com/instance/cpu/utilization',
            'compute.googleapis.com/instance/disk/write_ops_count',
            'compute.googleapis.com/instance/uptime',
        ]}
    },
    
    alignmentMapping: function(kind, valueType) {
      if(kind === 'CUMULATIVE') {
        return 'ALIGN_RATE';
      } else if(kind === 'GAUGE') {
        if(valueType == 'STRING') {
            return 'ALIGN_NONE';
        }
        return 'ALIGN_INTERPOLATE';
      } else if(kind === 'DELTA') {
        if(valueType == 'DISTRIBUTION') {
            return 'ALIGN_PERCENTILE_95';
        }
        return 'ALIGN_RATE';
      } else {
        return 'ALIGN_RATE';
      }
    }
};

module.exports = packageData;
