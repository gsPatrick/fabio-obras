const dashboardService = require('./dashboard.service');
const logger = require('../../utils/logger'); // Adiciona logger

class DashboardController {
  // GET /dashboard/kpis?period=monthly&...
  async getKPIs(req, res) {
    try {
      // Passa req.profileId para o service para filtrar os dados
      const data = await dashboardService.getKPIs(req.query, req.profileId);
      res.status(200).json(data);
    } catch (error) {
      logger.error('[DashboardController] Erro ao buscar KPIs:', error);
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
      logger.error('[DashboardController] Erro ao buscar dados de gráficos:', error);
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
      logger.error('[DashboardController] Erro ao buscar despesas detalhadas:', error);
      res.status(500).json({ error: error.message });
    }
  }
  
  // <<< NOVO: GET /dashboard/revenues >>>
  async getDetailedRevenues(req, res) {
    try {
      const data = await dashboardService.getDetailedRevenues(req.query, req.profileId);
      res.status(200).json(data);
    } catch (error) {
      logger.error('[DashboardController] Erro ao buscar receitas detalhadas:', error);
      res.status(500).json({ error: error.message });
    }
  }
  // <<< FIM NOVO >>>

  // PUT /dashboard/expenses/:id
  async updateExpense(req, res) {
    try {
      // Passa req.profileId para o service para garantir que a despesa pertence ao perfil
      const expense = await dashboardService.updateExpense(req.params.id, req.body, req.profileId);
      res.status(200).json(expense);
    } catch (error) {
      logger.error('[DashboardController] Erro ao atualizar despesa:', error);
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
      logger.error('[DashboardController] Erro ao deletar despesa:', error);
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
      logger.error('[DashboardController] Erro ao criar receita:', error);
      res.status(400).json({ error: error.message });
    }
  }
  
  // <<< NOVO: PUT /dashboard/revenues/:id >>>
  async updateRevenue(req, res) {
    try {
      const revenue = await dashboardService.updateRevenue(req.params.id, req.body, req.profileId);
      res.status(200).json(revenue);
    } catch (error) {
      logger.error('[DashboardController] Erro ao atualizar receita:', error);
      res.status(404).json({ error: error.message });
    }
  }
  // <<< FIM NOVO >>>

  // <<< NOVO: DELETE /dashboard/revenues/:id >>>
  async deleteRevenue(req, res) {
    try {
      const result = await dashboardService.deleteRevenue(req.params.id, req.profileId);
      res.status(200).json(result);
    } catch (error) {
      logger.error('[DashboardController] Erro ao deletar receita:', error);
      res.status(404).json({ error: error.message });
    }
  }
  // <<< FIM NOVO >>>

  // <<< NOVO: GET /dashboard/credit-card-invoice >>>
  async getCreditCardInvoice(req, res) {
    const { creditCardId, month, year } = req.query;
    if (!creditCardId || !month || !year) {
      return res.status(400).json({ error: 'ID do Cartão, Mês e Ano são obrigatórios.' });
    }
    try {
      const invoice = await dashboardService.getCreditCardInvoice(req.profileId, creditCardId, parseInt(month, 10), parseInt(year, 10));
      res.status(200).json(invoice);
    } catch (error) {
      logger.error('[DashboardController] Erro ao buscar fatura de cartão:', error);
      res.status(400).json({ error: error.message });
    }
  }
  // <<< FIM NOVO >>>
}

module.exports = new DashboardController();