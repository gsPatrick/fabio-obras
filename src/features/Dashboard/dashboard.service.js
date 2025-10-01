// src/features/Dashboard/dashboard.service.js
const { Expense, Category, Revenue, MonthlyGoal, sequelize } = require('../../models');
const { Op } = require('sequelize');
const { parseISO, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear, subDays, eachDayOfInterval, format } = require('date-fns');

class DashboardService {

  // ===================================================================
  // 1. ENDPOINT DE KPIs (NÚMEROS PRINCIPAIS) - COM ALERTA DE META
  // ===================================================================
  async getKPIs(filters, profileId) {
    if (!profileId) throw new Error('ID do Perfil é obrigatório.');
      
    const { whereClause: expenseWhere } = this._buildWhereClause(filters);
    
    // Sobrescreve o período para o MÊS CORRENTE para o cálculo da meta
    const now = new Date();
    const startOfCurrentMonth = startOfMonth(now);
    const endOfCurrentMonth = endOfMonth(now);
    
    const monthlyExpenseWhere = { 
        profile_id: profileId,
        expense_date: { [Op.between]: [startOfCurrentMonth, endOfCurrentMonth] } 
    };
    
    // --- Cálculo de KPIs (baseado no filtro fornecido) ---
    expenseWhere.profile_id = profileId;

    const revenueWhere = { profile_id: profileId };
    if (expenseWhere.expense_date) {
        revenueWhere.revenue_date = expenseWhere.expense_date;
    }

    const totalExpenses = await Expense.sum('value', { where: expenseWhere });
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
    
    // --- Lógica de Meta Mensal (baseado no MÊS CORRENTE) ---
    const currentMonthExpenses = await Expense.sum('value', { where: monthlyExpenseWhere });
    const totalGoal = await MonthlyGoal.findOne({ where: { profile_id: profileId, is_total_goal: true, category_id: null } });

    const goalAlert = this._calculateGoalAlert(currentMonthExpenses, totalGoal);
    
    return {
        totalExpenses: totalExpenses || 0,
        totalRevenues: totalRevenues || 0,
        balance: (totalRevenues || 0) - (totalExpenses || 0),
        expenseCount: await Expense.count({ where: expenseWhere }),
        highestCategory,
        goalAlert, // NOVO CAMPO
    };
}

  // ===================================================================
  // LÓGICA INTERNA: CÁLCULO DE ALERTA DE META
  // ===================================================================
  _calculateGoalAlert(currentExpenses, totalGoal) {
    if (!totalGoal) return null;

    const goalValue = parseFloat(totalGoal.value);
    if (goalValue <= 0) return null;
    
    const percentage = (currentExpenses / goalValue) * 100;
    
    // Define os limites de alerta conforme pedido (70, 80, 90, 100, 110)
    const limits = [70, 80, 90, 100, 110];
    let alertMessage = null;
    
    for (const limit of limits) {
        if (percentage >= limit && percentage < limit + 10) { // Verifica o intervalo 70-79.99, 80-89.99 etc.
            alertMessage = `Atenção: Você atingiu ${limit}% da sua meta mensal de custo total!`;
            break; 
        } else if (percentage >= 110) {
            alertMessage = `ALERTA CRÍTICO: Você excedeu em mais de 10% a sua meta mensal de custo total!`;
            break;
        }
    }
    
    if (alertMessage) {
        return {
            message: alertMessage,
            percentage: parseFloat(percentage.toFixed(2)),
            currentExpenses: currentExpenses,
            goalValue: goalValue,
            status: percentage < 100 ? 'warning' : 'critical'
        };
    }
    
    return null;
  }
  
  // ===================================================================
  // 2. ENDPOINT PARA GRÁFICOS
  // ===================================================================
  async getChartData(filters, profileId) {
    if (!profileId) throw new Error('ID do Perfil é obrigatório.');

    const { whereClause, startDate, endDate } = this._buildWhereClause(filters);
    whereClause.profile_id = profileId; // FILTRO POR PERFIL

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
  async getDetailedExpenses(filters, profileId) {
    if (!profileId) throw new Error('ID do Perfil é obrigatório.');
      
    const { whereClause, limit, offset } = this._buildWhereClause(filters);
    whereClause.profile_id = profileId; // FILTRO POR PERFIL

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

  async getAllExpenses(profileId) {
    if (!profileId) throw new Error('ID do Perfil é obrigatório.');
      
    return Expense.findAll({
      where: { profile_id: profileId }, // FILTRO POR PERFIL
      include: [{ model: Category, as: 'category', attributes: ['name'] }],
      order: [['expense_date', 'DESC']],
    });
  }
  
  // ===================================================================
  // 4. ENDPOINTS CRUD (CRIAR, ATUALIZAR, DELETAR)
  // ===================================================================
  async updateExpense(id, data, profileId) {
    const expense = await Expense.findOne({ where: { id, profile_id: profileId } }); // FILTRO POR PERFIL
    if (!expense) throw new Error('Despesa não encontrada ou não pertence ao perfil');
    await expense.update(data);
    return expense;
  }
  
  async deleteExpense(id, profileId) {
    const expense = await Expense.findOne({ where: { id, profile_id: profileId } }); // FILTRO POR PERFIL
    if (!expense) throw new Error('Despesa não encontrada ou não pertence ao perfil');
    await expense.destroy();
    return { message: 'Despesa deletada com sucesso' };
  }
  
  async createRevenue(data, profileId) {
    if (!profileId) throw new Error('ID do Perfil é obrigatório.');
    return Revenue.create({ ...data, profile_id: profileId }); // INSERIR profile_id
  }

  // ===================================================================
  // LÓGICA INTERNA DE FILTROS (MUITO PODEROSA)
  // ===================================================================
  _buildWhereClause(filters) {
    const whereClause = {};
    let startDate, endDate;

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
        default: startDate = startOfMonth(now); endDate = endOfMonth(now);
      }
    } else if (filters.startDate && filters.endDate) {
      startDate = parseISO(filters.startDate);
      endDate = endOfDay(parseISO(filters.endDate));
    }
    
    if (startDate && endDate) {
      whereClause.expense_date = { [Op.between]: [startDate, endDate] };
    }

    if (filters.categoryId) {
      whereClause.category_id = filters.categoryId;
    }

    if (filters.description) {
      whereClause.description = { [Op.iLike]: `%${filters.description}%` };
    }

    if (filters.minValue) {
      whereClause.value = { ...whereClause.value, [Op.gte]: filters.minValue };
    }
    if (filters.maxValue) {
      whereClause.value = { ...whereClause.value, [Op.lte]: filters.maxValue };
    }

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