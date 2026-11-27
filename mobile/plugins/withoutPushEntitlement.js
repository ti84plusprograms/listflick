const { withEntitlementsPlist } = require('@expo/config-plugins');

// expo-notifications adds the Push Notifications capability (aps-environment), but
// ListFlick only schedules local notifications, which need no entitlement. Without it
// the app can be signed by personal development teams, which can't use push.
// Remove this plugin if the app ever registers for remote push notifications.
module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults['aps-environment'];
    return cfg;
  });
};
