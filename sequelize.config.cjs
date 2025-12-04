require("dotenv").config();

module.exports = {
  development: {
    url:
      process.env.DATABASE_URL ??
      "postgres://localhost:5432/tiger_server_development",
    dialect: "postgres",
    logging: false,
  },
  production: {
    url: process.env.DATABASE_URL,
    dialect: "postgres",
    logging: false,
  },
};
