const os = require("os");

function getLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (info.family === "IPv4" && !info.internal && !info.address.startsWith("169.254.")) {
        return info.address;
      }
    }
  }
  return "127.0.0.1";
}

module.exports = {
  PORT: Number(process.env.PORT || 8088),
  HOST: "0.0.0.0",
  PUBLIC_HOST: process.env.PUBLIC_HOST || "",
  DEFAULT_LAN_IP: getLanIp(),
  SERVER_ID: 1,
  OLD_SERVER_ID: 1,
  SERVER_NAME: "Sunny Pirates S1 (Private)",
  AUTO_REGISTER_ON_LOGIN: true,
  STARTER: {
    LEVEL: 1,
    COIN: 5000000,
    GEM: 100000,
    VIP_LEVEL: 15,
    VIP_EXP: 100000,
    ACTION_POINT: 500,
    SKILL_POINT: 30,
    INIT_ROLES: [100101], // Luffy
    GM_LEVEL: 5
  },
  GM_ENABLED: true,
  HEARTBEAT_SECONDS: 15
};
