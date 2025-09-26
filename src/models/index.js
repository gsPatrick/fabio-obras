const Sequelize = require('sequelize');
const dbConfig = require('../config/database');

const Category = require('./Category');
const Expense = require('./Expense');
const Attachment = require('./Attachment');
const Revenue = require('./Revenue');
const MonitoredGroup = require('./MonitoredGroup');
const PendingExpense = require('./PendingExpense'); // <<< IMPORTAR O NOVO MODEL
const User = require('./User'); // <<< ADICIONAR IMPORT

const models = [
  Category,
  Expense,
  Attachment,
  Revenue,
  MonitoredGroup,
  PendingExpense,
  User
];

class Database {
  constructor() {
    this.connection = new Sequelize(dbConfig);
    this.init();
    this.associate();
  }

  init() {
    models.forEach(model => model.init(this.connection));
  }

  associate() {
    models.forEach(model => {
      if (model.associate) {
        model.associate(this.connection.models);
      }
    });
  }
}

const db = new Database();

module.exports = {
  sequelize: db.connection,
  Sequelize: Sequelize,
  ...db.connection.models,
};
