var AWS    = require('aws-sdk')
  , async  = require('async')
  , domain = require('domain');

AWS.config.update({region:'ap-northeast-1'});

var DryRun = process.env.DRY_RUN || false;

exports.handler = function(event, context) {
  var ec2 = new AWS.EC2()
    , d   = domain.create();

  d.on('error', function (err) {
    console.error(err, err.stack);
    return context.done('error', err.stack);
  });

  var succeed = function () {
    context.done(null, 'success');
  }

  var parseTime = function (timeString) {
    if (null === timeString) {
      return null;
    }

    try {
      var date = new Date();
      var time = timeString.match(/(\d+)(?::(\d\d))?\s*(p?)/);
      date.setHours( parseInt(time[1]) + (time[3] ? 12 : 0) );
      date.setMinutes( parseInt(time[2]) || 0 );
      date.setSeconds(0);
      return date;
    } catch (e) {
      console.error('Fail to parse time: ' + timeString);
      return null;
    }
  }

  var getInstanceTag = function (instance, tagName) {
    var tags = instance.Tags.filter(function (tag) {
      return tagName === tag.Key;
    });
    if (1 > tags.length) {
      return null;
    }
    return tags[0].Value;
  }

  ec2.describeInstances({
    DryRun: DryRun,
    Filters: [ { Name: 'tag-key', Values: [ 'PowerOn', 'PowerOff' ] } ]
  }, d.intercept(function (data) {

    var instances = data
    .Reservations[0]
    .Instances
    .map(function (instance) {
      var powerOnTagValue  = getInstanceTag(instance, 'PowerOn');
      var powerOffTagValue = getInstanceTag(instance, 'PowerOff');

      return {
        id: instance.InstanceId,
        state: instance.State.Name,
        powerOnDate: parseTime(powerOnTagValue),
        powerOffDate: parseTime(powerOffTagValue)
      }
    }).filter(function (instance) {
      return (instance.scheduleTime !== null);
    });

    if (instances.length === 0) {
      return succeed();
    }

    var now = new Date();

    var powerOnTargets = instances.filter(function (instance) {
      if (instance.state !== 'stopped' || null === instance.powerOnDate) {
        return false;
      }

      if (null === instance.powerOffDate) {
        return instance.powerOnDate.getTime() < now.getTime();
      }

      return (instance.powerOnDate.getTime() < now.getTime()) &&
             (instance.powerOffDate.getTime() > now.getTime());
    }).map(function (instance) {
      return instance.id;
    });

    var powerOffTargets = instances.filter(function (instance) {
      if (instance.state !== 'running' || null === instance.powerOffDate) {
        return false;
      }

      return instance.powerOffDate.getTime() < now.getTime();
    }).map(function (instance) {
      return instance.id;
    });

    console.log('Power on  instnaces: [' + powerOnTargets  + ']');
    console.log('Power off instnaces: [' + powerOffTargets + ']');

    async.parallel([
      function(callback) {
        if (0 === powerOnTargets.length) {
          return callback(null);
        }
        ec2.startInstances({
          DryRun: DryRun,
          InstanceIds: powerOnTargets
        }, callback);
      },
      function(callback) {
        if (0 === powerOffTargets.length) {
          return callback(null);
        }
        ec2.stopInstances({
          DryRun: DryRun,
          InstanceIds: powerOffTargets
        }, callback);
      }
    ], d.intercept(succeed));
  }));
};
