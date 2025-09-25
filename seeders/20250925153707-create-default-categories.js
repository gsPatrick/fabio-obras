'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.bulkInsert('categories', [
      // Mão de Obra
      { name: 'Mão de obra estrutural', type: 'Mão de Obra', created_at: new Date(), updated_at: new Date() },
      { name: 'Mão de obra cinza', type: 'Mão de Obra', created_at: new Date(), updated_at: new Date() },
      { name: 'Mão de obra acabamento', type: 'Mão de Obra', created_at: new Date(), updated_at: new Date() },
      { name: 'Mão de obra gesso', type: 'Mão de Obra', created_at: new Date(), updated_at: new Date() },
      { name: 'Mão de obra pintura', type: 'Mão de Obra', created_at: new Date(), updated_at: new Date() },
      { name: 'Mão de obra vidro', type: 'Mão de Obra', created_at: new Date(), updated_at: new Date() },
      { name: 'Mão de obra esquadrias', type: 'Mão de Obra', created_at: new Date(), updated_at: new Date() },
      { name: 'Mão de obra hidráulica e elétrica', type: 'Mão de Obra', created_at: new Date(), updated_at: new Date() },

      // Material
      { name: 'Material ferro', type: 'Material', created_at: new Date(), updated_at: new Date() },
      { name: 'Material concreto', type: 'Material', created_at: new Date(), updated_at: new Date() },
      { name: 'Material bruto', type: 'Material', created_at: new Date(), updated_at: new Date() },
      { name: 'Material piso', type: 'Material', created_at: new Date(), updated_at: new Date() },
      { name: 'Material argamassa', type: 'Material', created_at: new Date(), updated_at: new Date() },
      { name: 'Material gesso', type: 'Material', created_at: new Date(), updated_at: new Date() },
      { name: 'Material esquadria', type: 'Material', created_at: new Date(), updated_at: new Date() },
      { name: 'Material pintura', type: 'Material', created_at: new Date(), updated_at: new Date() },
      { name: 'Material fios', type: 'Material', created_at: new Date(), updated_at: new Date() },
      { name: 'Material iluminação', type: 'Material', created_at: new Date(), updated_at: new Date() },
      { name: 'Material pedras granitos', type: 'Material', created_at: new Date(), updated_at: new Date() },
      { name: 'Material louças e metais', type: 'Material', created_at: new Date(), updated_at: new Date() },
      { name: 'Material equipamentos', type: 'Material', created_at: new Date(), updated_at: new Date() },
      { name: 'Material ar condicionado', type: 'Material', created_at: new Date(), updated_at: new Date() },
      { name: 'Material hidráulica', type: 'Material', created_at: new Date(), updated_at: new Date() },
      
      // Serviços/Equipamentos
      { name: 'Marcenaria', type: 'Serviços/Equipamentos', created_at: new Date(), updated_at: new Date() },
      { name: 'Eletros', type: 'Serviços/Equipamentos', created_at: new Date(), updated_at: new Date() },
      
      // Outros
      { name: 'Outros', type: 'Outros', created_at: new Date(), updated_at: new Date() },
    ], {});
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('categories', null, {});
  }
};