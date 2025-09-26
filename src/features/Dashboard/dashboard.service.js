// src/features/Dashboard/dashboard.service.js
const { Expense, Category, Revenue, sequelize } = require('../../models');
const { Op } = require('sequelize');
const { parseISO, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear, subDays, eachDayOfInterval, format } = require('date-fns');

class DashboardService {

  // ===================================================================
  // 1. ENDPOINT DE KPIs (NÚMEROS PRINCIPAIS)
  // ===================================================================
  async getKPIs(filters) {
    const { whereClause: expenseWhere } = this._buildWhereClause(filters);

    // Crie uma cláusula 'where' específica para receitas, traduzindo o campo de data.
    const revenueWhere = {};
    if (expenseWhere.expense_date) {
        revenueWhere.revenue_date = expenseWhere.expense_date;
    }
    // Se houver outros filtros que também se aplicam a receitas, copie-os aqui.

    const totalExpenses = await Expense.sum('value', { where: expenseWhere });
    // Use a cláusula correta para a consulta de receitas (mantido para compatibilidade, mas não usado no relatório do WhatsApp)
    const totalRevenues = await Revenue.sum('value', { where: revenueWhere });

    const expensesByCategory = await Expense.findAll({
        where: expenseWhere,
        attributes: [
            [sequelize.fn('SUM', sequelize.col('value')), 'total'],
        ],
        include: [{ model: Category, as: 'category', attributes: ['name'] }],
        group: ['category.id', 'category.name'],
        order: [[sequelize.fn('SUM', sequelize.col('value')), 'DESC']],
        limit: 1,
        raw: true
    });

    const highestCategory = expensesByCategory.length > 0 ? {
        name: expensesByCategory[0]['category.name'],
        total: parseFloat(expensesByCategory[0].total)
    } : { name: 'N/A', total: 0 };
    
    return {
        totalExpenses: totalExpenses || 0,
        totalRevenues: totalRevenues || 0,
        balance: (totalRevenues || 0) - (totalExpenses || 0),
        expenseCount: await Expense.count({ where: expenseWhere }),
        highestCategory,
    };
}

  // ===================================================================
  // 2. ENDPOINT PARA GRÁFICOS
  // ===================================================================
  async getChartData(filters) {
    const { whereClause, startDate, endDate } = this._buildWhereClause(filters);

    // DADOS PARA GRÁFICO DE PIZZA (Gastos por Categoria)
    const expensesByCategory = await Expense.findAll({
      where: whereClause,
      attributes: [
        'category.name',
        [sequelize.fn('SUM', sequelize.col('value')), 'total'],
      ],
      include: [{ model: Category, as: 'category', attributes: [] }],
      group: ['category.name'],
      raw: true,
    });

    // DADOS PARA GRÁFICO DE LINHA (Evolução de Gastos no Tempo)
    const dailyExpenses = await Expense.findAll({
      where: whereClause,
      attributes: [
        [sequelize.fn('DATE', sequelize.col('expense_date')), 'date'],
        [sequelize.fn('SUM', sequelize.col('value')), 'total'],
      ],
      group: [sequelize.fn('DATE', sequelize.col('expense_date'))],
      order: [[sequelize.fn('DATE', sequelize.col('expense_date')), 'ASC']],
      raw: true
    });

    // Preenche os dias sem gastos para um gráfico contínuo
    const evolution = this._fillMissingDays(dailyExpenses, startDate, endDate);

    return {
      pieChart: expensesByCategory.map(item => ({ name: item.name, value: parseFloat(item.total) })),
      lineChart: {
        labels: evolution.map(item => item.date),
        data: evolution.map(item => item.total)
      },
    };
  }

  // ===================================================================
  // 3. ENDPOINT PARA RELATÓRIOS (LISTA DETALHADA COM FILTROS)
  // ===================================================================
  async getDetailedExpenses(filters) {
    const { whereClause, limit, offset } = this._buildWhereClause(filters);

    const { count, rows } = await Expense.findAndCountAll({
      where: whereClause,
      include: [{ model: Category, as: 'category', attributes: ['id', 'name'] }],
      order: [['expense_date', 'DESC']],
      limit,
      offset,
    });

    return {
      totalItems: count,
      totalPages: Math.ceil(count / limit),
      currentPage: filters.page || 1,
      data: rows,
    };
  }

  // MUDANÇA: NOVA FUNÇÃO PARA PEGAR TODAS AS DESPESAS SEM PAGINAÇÃO
  async getAllExpenses() {
    return Expense.findAll({
      include: [{ model: Category, as: 'category', attributes: ['name'] }],
      order: [['expense_date', 'DESC']],
    });
  }
  
  // ===================================================================
  // 4. ENDPOINTS CRUD (CRIAR, ATUALIZAR, DELETAR)
  // ===================================================================
  async updateExpense(id, data) {
    const expense = await Expense.findByPk(id);
    if (!expense) throw new Error('Despesa não encontrada');
    await expense.update(data);
    return expense;
  }
  
  async deleteExpense(id) {
    const expense = await Expense.findByPk(id);
    if (!expense) throw new Error('Despesa não encontrada');
    await expense.destroy();
    return { message: 'Despesa deletada com sucesso' };
  }
  
  async createRevenue(data) {
    return Revenue.create(data);
  }
  // (Funções para editar/deletar receitas podem ser adicionadas aqui)

  // ===================================================================
  // LÓGICA INTERNA DE FILTROS (MUITO PODEROSA)
  // ===================================================================
  _buildWhereClause(filters) {
    const whereClause = {};
    let startDate, endDate;

    // Filtro por Período de Tempo
    if (filters.period) {
      const now = new Date();
      switch (filters.period) {
        case 'daily': startDate = startOfDay(now); endDate = endOfDay(now); break;
        case 'weekly': startDate = startOfWeek(now, { weekStartsOn: 1 }); endDate = endOfWeek(now, { weekStartsOn: 1 }); break;
        case 'monthly': startDate = startOfMonth(now); endDate = endOfMonth(now); break;
        case 'quarterly': startDate = startOfQuarter(now); endDate = endOfQuarter(now); break;
        case 'yearly': startDate = startOfYear(now); endDate = endOfYear(now); break;
        case 'last7days': startDate = startOfDay(subDays(now, 6)); endDate = endOfDay(now); break;
        case 'last30days': startDate = startOfDay(subDays(now, 29)); endDate = endOfDay(now); break;
        default: startDate = startOfMonth(now); endDate = endOfMonth(now); // Padrão para mensal se não especificado
      }
    } else if (filters.startDate && filters.endDate) {
      startDate = parseISO(filters.startDate);
      endDate = endOfDay(parseISO(filters.endDate));
    }
    
    if (startDate && endDate) {
      whereClause.expense_date = { [Op.between]: [startDate, endDate] };
    }

    // Filtro por Categoria
    if (filters.categoryId) {
      whereClause.category_id = filters.categoryId;
    }

    // Filtro por Descrição (Busca textual)
    if (filters.description) {
      whereClause.description = { [Op.iLike]: `%${filters.description}%` }; // Case-insensitive
    }

    // Filtro por Faixa de Valor
    if (filters.minValue) {
      whereClause.value = { ...whereClause.value, [Op.gte]: filters.minValue }; // gte = >=
    }
    if (filters.maxValue) {
      whereClause.value = { ...whereClause.value, [Op.lte]: filters.maxValue }; // lte = <=
    }

    // Paginação
    const page = parseInt(filters.page, 10) || 1;
    const limit = parseInt(filters.limit, 10) || 20;
    const offset = (page - 1) * limit;

    return { whereClause, limit, offset, startDate, endDate };
  }

  _fillMissingDays(data, startDate, endDate) {
    const dataMap = new Map(data.map(item => [format(new Date(item.date), 'yyyy-MM-dd'), parseFloat(item.total)]));
    const interval = eachDayOfInterval({ start: startDate, end: endDate });

    return interval.map(day => {
      const dayStr = format(day, 'yyyy-MM-dd');
      return {
        date: dayStr,
        total: dataMap.get(dayStr) || 0,
      };
    });
  }
}

module.exports = new DashboardService();