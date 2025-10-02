// src/features/CategoryManager/category.controller.js

const categoryService = require('./category.service');

class CategoryController {
  async getAll(req, res) {
    try {
      const categories = await categoryService.getAll(req.profileId); // <<< Agora req.profileId deve vir do middleware
      res.status(200).json(categories);
    } catch (error) {
      res.status(400).json({ error: error.message }); // 400 se profileId for nulo (checado no service)
    }
  }

  async getById(req, res) {
    try {
      const category = await categoryService.getById(req.params.id, req.profileId); 
      res.status(200).json(category);
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  }

  async create(req, res) {
    try {
      const category = await categoryService.create(req.body, req.profileId); // <<< Agora req.profileId deve vir do middleware
      res.status(201).json(category);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async update(req, res) {
    try {
      const category = await categoryService.update(req.params.id, req.body, req.profileId);
      res.status(200).json(category);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async delete(req, res) {
    try {
      const result = await categoryService.delete(req.params.id, req.profileId);
      res.status(200).json(result);
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  }
}

module.exports = new CategoryController();