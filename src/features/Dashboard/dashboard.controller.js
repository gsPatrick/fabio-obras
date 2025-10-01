const dashboardService = require('./dashboard.service');

class DashboardController {
  // GET /dashboard/kpis?period=monthly&...
  async getKPIs(req, res) {
    try {
      // Passa req.profileId para o service para filtrar os dados
      const data = await dashboardService.getKPIs(req.query, req.profileId);
      res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // GET /dashboard/charts?period=monthly&...
  async getChartData(req, res) {
    try {
      // Passa req.profileId para o service para filtrar os dados
      const data = await dashboardService.getChartData(req.query, req.profileId);
      res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // GET /dashboard/expenses?page=1&limit=20&...
  async getDetailedExpenses(req, res) {
    try {
      // Passa req.profileId para o service para filtrar os dados
      const data = await dashboardService.getDetailedExpenses(req.query, req.profileId);
      res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
  
  // PUT /dashboard/expenses/:id
  async updateExpense(req, res) {
    try {
      // Passa req.profileId para o service para garantir que a despesa pertence ao perfil
      const expense = await dashboardService.updateExpense(req.params.id, req.body, req.profileId);
      res.status(200).json(expense);
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  }
  
  // DELETE /dashboard/expenses/:id
  async deleteExpense(req, res) {
    try {
      // Passa req.profileId para o service para garantir que a despesa pertence ao perfil
      const result = await dashboardService.deleteExpense(req.params.id, req.profileId);
      res.status(200).json(result);
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  }
  
  // POST /dashboard/revenues
  async createRevenue(req, res) {
    try {
      // Passa req.profileId para o service para associar a receita ao perfil
      const revenue = await dashboardService.createRevenue(req.body, req.profileId);
      res.status(201).json(revenue);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }
}

module.exports = new DashboardController();