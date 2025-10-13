// src/features/Dashboard/dashboard.service.js
const { Expense, Category, Revenue, MonthlyGoal, CreditCard, sequelize } = require('../../models');
const { Op } = require('sequelize');
const { parseISO, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear, subDays, eachDayOfInterval, format, addMonths } = require('date-fns');
const logger = require('../../utils/logger');

class DashboardService {

  // ===================================================================
  // 1. ENDPOINT DE KPIs
  // ===================================================================
  async getKPIs(filters, profileId) {
    if (!profileId) throw new Error('ID do Perfil é obrigatório.');
      
    const { whereClause: expenseWhere } = this._buildWhereClause(filters, 'expense');
    
    const now = new Date();
    const startOfCurrentMonth = startOfMonth(now);
    const endOfCurrentMonth = endOfMonth(now);
    
    const monthlyExpenseWhere = { 
        profile_id: profileId,
        [Op.or]: [
            { expense_date: { [Op.between]: [startOfCurrentMonth, endOfCurrentMonth] } },
            { charge_date: { [Op.between]: [startOfCurrentMonth, endOfCurrentMonth] } }
        ],
        // Exclui parcelas subsequentes da soma de metas
        original_expense_id: { [Op.eq]: null },
    };
    
    expenseWhere.profile_id = profileId;
    expenseWhere.original_expense_id = { [Op.eq]: null }; 

    const revenueWhere = { profile_id: profileId };
    if (expenseWhere[Op.or]) {
        const dateRange = expenseWhere[Op.or][0].expense_date || expenseWhere[Op.or][1].charge_date;
        if (dateRange) {
            revenueWhere.revenue_date = dateRange;
        }
    }

    const totalExpenses = await Expense.sum('value', { where: expenseWhere });
    const totalRevenues = await Revenue.sum('value', { where: revenueWhere });

    const expensesByCategory = await Expense.findAll({
        where: expenseWhere,
        attributes: [
            [sequelize.fn('SUM', sequelize.col('Expense.value')), 'total'],
        ],
        include: [{ model: Category, as: 'category', attributes: ['name'], where: { category_flow: 'expense' } }],
        group: ['category.id', 'category.name'],
        order: [[sequelize.fn('SUM', sequelize.col('Expense.value')), 'DESC']],
        limit: 1,
        raw: true
    });

    const highestCategory = expensesByCategory.length > 0 ? {
        name: expensesByCategory[0]['category.name'],
        total: parseFloat(expensesByCategory[0].total)
    } : { name: 'N/A', total: 0 };
    
    const currentMonthExpenses = await Expense.sum('value', { where: monthlyExpenseWhere });
    const totalGoal = await MonthlyGoal.findOne({ where: { profile_id: profileId, is_total_goal: true, category_id: null } });

    const goalAlert = this._calculateGoalAlert(currentMonthExpenses, totalGoal);
    
    return {
        totalExpenses: totalExpenses || 0,
        totalRevenues: totalRevenues || 0,
        balance: (totalRevenues || 0) - (totalExpenses || 0),
        expenseCount: await Expense.count({ where: expenseWhere }),
        highestCategory,
        goalAlert,
    };
}

  // ===================================================================
  // LÓGICA INTERNA: CÁLCULO DE ALERTA DE META
  // ===================================================================
  _calculateGoalAlert(currentExpenses, totalGoal) {
    if (!totalGoal || !currentExpenses) return null;

    const goalValue = parseFloat(totalGoal.value);
    if (goalValue <= 0) return null;
    
    const percentage = (currentExpenses / goalValue) * 100;
    
    const limits = [70, 80, 90, 100, 110];
    let alertMessage = null;
    
    for (const limit of limits) {
        if (percentage >= limit && percentage < limit + 10) {
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

    const { whereClause: expenseWhere, startDate, endDate } = this._buildWhereClause(filters, 'expense');
    expenseWhere.profile_id = profileId;
    
    const { whereClause: revenueWhere } = this._buildWhereClause(filters, 'revenue');
    revenueWhere.profile_id = profileId;

    const expensesByCategory = await Expense.findAll({
      where: { ...expenseWhere, original_expense_id: { [Op.eq]: null } },
      attributes: [ 'category.name', [sequelize.fn('SUM', sequelize.col('Expense.value')), 'total'], ],
      include: [{ model: Category, as: 'category', attributes: [], where: { category_flow: 'expense' } }],
      group: ['category.name'], raw: true,
    });
    
    const revenuesByCategory = await Revenue.findAll({
        where: revenueWhere,
        attributes: [ 'category.name', [sequelize.fn('SUM', sequelize.col('Revenue.value')), 'total'], ],
        include: [{ model: Category, as: 'category', attributes: [], where: { category_flow: 'revenue' } }],
        group: ['category.name'], raw: true,
    });

    const expensesByType = await Expense.findAll({
        where: { ...expenseWhere, original_expense_id: { [Op.eq]: null } },
        attributes: [ 'category.type', [sequelize.fn('SUM', sequelize.col('Expense.value')), 'total'], ],
        include: [{ model: Category, as: 'category', attributes: [], where: { category_flow: 'expense' } }],
        group: ['category.type'], raw: true,
    });

    const dailyExpenses = await Expense.findAll({
      where: expenseWhere,
      attributes: [
        [sequelize.fn('DATE', sequelize.fn('COALESCE', sequelize.col('Expense.charge_date'), sequelize.col('Expense.expense_date'))), 'date'],
        [sequelize.fn('SUM', sequelize.col('Expense.value')), 'total'],
      ],
      group: [sequelize.fn('DATE', sequelize.fn('COALESCE', sequelize.col('Expense.charge_date'), sequelize.col('Expense.expense_date')))],
      order: [[sequelize.fn('DATE', sequelize.fn('COALESCE', sequelize.col('Expense.charge_date'), sequelize.col('Expense.expense_date'))), 'ASC']],
      raw: true
    });
    
    const formattedDailyExpenses = dailyExpenses.map(item => ({ date: item.date, total: parseFloat(item.total) }));

    const evolution = this._fillMissingDays(formattedDailyExpenses, startDate, endDate);

    return {
      pieChart: expensesByCategory.map(item => ({ name: item.name, value: parseFloat(item.total) })),
      revenuePieChart: revenuesByCategory.map(item => ({ name: item.name, value: parseFloat(item.total) })),
      pieChartByType: expensesByType.map(item => ({ name: item.type, value: parseFloat(item.total) })),
      lineChart: { labels: evolution.map(item => item.date), data: evolution.map(item => item.total) },
    };
  }

  // ===================================================================
  // 3. ENDPOINT PARA RELATÓRIOS (LISTA DETALHADA COM FILTROS)
  // ===================================================================
  async getDetailedExpenses(filters, profileId) {
    if (!profileId) throw new Error('ID do Perfil é obrigatório.');
      
    const { whereClause, limit, offset } = this._buildWhereClause(filters, 'expense');
    whereClause.profile_id = profileId;

    const { count, rows } = await Expense.findAndCountAll({
      where: whereClause,
      include: [
        { model: Category, as: 'category', attributes: ['id', 'name', 'type', 'category_flow'] },
        { model: CreditCard, as: 'creditCard', attributes: ['id', 'name', 'last_four_digits'] },
        { model: Expense, as: 'originalExpense', attributes: ['id', 'description', 'value'] }
      ],
      // <<< CORREÇÃO APLICADA AQUI >>>
      order: [[sequelize.fn('COALESCE', sequelize.col('Expense.charge_date'), sequelize.col('Expense.expense_date')), 'DESC']],
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
  
  async getDetailedRevenues(filters, profileId) {
    if (!profileId) throw new Error('ID do Perfil é obrigatório.');
      
    const { whereClause, limit, offset } = this._buildWhereClause(filters, 'revenue');
    whereClause.profile_id = profileId;

    const { count, rows } = await Revenue.findAndCountAll({
      where: whereClause,
      include: [{ model: Category, as: 'category', attributes: ['id', 'name', 'type', 'category_flow'] }],
      order: [['revenue_date', 'DESC']],
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
      where: { profile_id: profileId },
      include: [
        { model: Category, as: 'category', attributes: ['name', 'type', 'category_flow'] },
        { model: CreditCard, as: 'creditCard', attributes: ['name', 'last_four_digits'] },
        { model: Expense, as: 'originalExpense', attributes: ['id', 'description', 'value'] }
      ],
      // <<< CORREÇÃO APLICADA AQUI >>>
      order: [[sequelize.fn('COALESCE', sequelize.col('Expense.charge_date'), sequelize.col('Expense.expense_date')), 'DESC']],
    });
  }
  
  async getAllRevenues(profileId) {
    if (!profileId) throw new Error('ID do Perfil é obrigatório.');
      
    return Revenue.findAll({
      where: { profile_id: profileId },
      include: [{ model: Category, as: 'category', attributes: ['name', 'type', 'category_flow'] }],
      order: [['revenue_date', 'DESC']],
    });
  }

  // ===================================================================
  // 4. ENDPOINTS CRUD
  // ===================================================================
  async updateExpense(id, data, profileId) {
    const expense = await Expense.findOne({ where: { id, profile_id: profileId } });
    if (!expense) throw new Error('Despesa não encontrada ou não pertence ao perfil');

    if (expense.original_expense_id && (data.value || data.total_installments || data.is_installment)) {
        throw new Error('Não é permitido alterar valor ou dados de parcelamento diretamente em uma parcela. Edite a despesa original.');
    }
    
    await expense.update(data);
    return expense;
  }
  
  async deleteExpense(id, profileId) {
    const expense = await Expense.findOne({ where: { id, profile_id: profileId } });
    if (!expense) throw new Error('Despesa não encontrada ou não pertence ao perfil');

    if (expense.is_installment && !expense.original_expense_id && expense.total_installments > 1) {
        await Expense.destroy({ where: { original_expense_id: expense.id, profile_id: profileId } });
    }
    await expense.destroy();
    return { message: 'Despesa e suas parcelas (se houver) deletadas com sucesso.' };
  }
  
  async createRevenue(data, profileId) {
    if (!profileId) throw new Error('ID do Perfil é obrigatório.');
    
    const category = await Category.findByPk(data.category_id);
    if (!category || category.profile_id !== profileId || category.category_flow !== 'revenue') {
        throw new Error('Categoria de receita inválida ou não pertence a este perfil.');
    }

    return Revenue.create({ ...data, profile_id: profileId });
  }

  async updateRevenue(id, data, profileId) {
    const revenue = await Revenue.findOne({ where: { id, profile_id: profileId } });
    if (!revenue) throw new Error('Receita não encontrada ou não pertence ao perfil');

    if (data.category_id) {
        const category = await Category.findByPk(data.category_id);
        if (!category || category.profile_id !== profileId || category.category_flow !== 'revenue') {
            throw new Error('Categoria de receita inválida ou não pertence a este perfil.');
        }
    }

    await revenue.update(data);
    return revenue;
  }

  async deleteRevenue(id, profileId) {
    const revenue = await Revenue.findOne({ where: { id, profile_id: profileId } });
    if (!revenue) throw new Error('Receita não encontrada ou não pertence ao perfil');
    await revenue.destroy();
    return { message: 'Receita deletada com sucesso.' };
  }

  // ===================================================================
  // LÓGICA INTERNA DE FILTROS
  // ===================================================================
  _buildWhereClause(filters, flowType = 'expense') {
    const whereClause = {};
    let startDate, endDate;

    const dateField = flowType === 'expense' ? 'expense_date' : 'revenue_date';
    const chargeDateField = 'charge_date';

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
        if (flowType === 'expense') {
            whereClause[Op.or] = [
                { [dateField]: { [Op.between]: [startDate, endDate] } },
                { [chargeDateField]: { [Op.between]: [startDate, endDate] } }
            ];
        } else {
            whereClause[dateField] = { [Op.between]: [startDate, endDate] };
        }
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
    
    if (flowType === 'expense' && filters.creditCardId) {
        whereClause.credit_card_id = filters.creditCardId;
    }

    const page = parseInt(filters.page, 10) || 1;
    const limit = parseInt(filters.limit, 10) || 20;
    const offset = (page - 1) * limit;

    return { whereClause, limit, offset, startDate, endDate };
  }

  _fillMissingDays(data, startDate, endDate) {
    if (!startDate || !endDate) return data;
    
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

  async getCreditCardInvoice(profileId, creditCardId, month, year) {
    if (!profileId || !creditCardId || !month || !year) {
      throw new Error('ID do Perfil, ID do Cartão, Mês e Ano são obrigatórios.');
    }

    const creditCard = await CreditCard.findOne({ where: { id: creditCardId, profile_id: profileId } });
    if (!creditCard) {
      throw new Error('Cartão de crédito não encontrado ou não pertence a este perfil.');
    }
    
    let invoiceEndDate = new Date(year, month - 1, creditCard.closing_day);
    let invoiceStartDate = addMonths(invoiceEndDate, -1);
    invoiceStartDate.setDate(creditCard.closing_day + 1);
    
    if (invoiceStartDate.getDate() !== (creditCard.closing_day + 1)) {
        invoiceStartDate = startOfMonth(addMonths(invoiceEndDate, -1));
        invoiceStartDate.setDate(creditCard.closing_day + 1);
    }
    if (invoiceEndDate.getDate() !== creditCard.closing_day) {
        invoiceEndDate = endOfMonth(new Date(year, month - 1, 1));
    }

    invoiceEndDate = endOfDay(invoiceEndDate);
    invoiceStartDate = startOfDay(invoiceStartDate);

    logger.info(`[CreditCardService] Buscando fatura para ${creditCard.name} (${month}/${year}). Período: ${invoiceStartDate.toISOString()} a ${invoiceEndDate.toISOString()}`);

    const expenses = await Expense.findAll({
      where: {
        profile_id: profileId,
        credit_card_id: creditCardId,
        expense_date: { [Op.between]: [invoiceStartDate, invoiceEndDate] },
      },
      include: [
        { model: Category, as: 'category', attributes: ['name', 'category_flow'] },
        { model: Expense, as: 'originalExpense', attributes: ['id', 'description', 'value', 'total_installments'] }
      ],
      order: [['expense_date', 'ASC']],
    });

    const totalAmount = expenses.reduce((sum, exp) => sum + parseFloat(exp.value), 0);

    return {
      creditCard: {
        id: creditCard.id,
        name: creditCard.name,
        last_four_digits: creditCard.last_four_digits,
        closing_day: creditCard.closing_day,
        due_day: creditCard.due_day,
      },
      invoicePeriod: {
        startDate: invoiceStartDate.toISOString(),
        endDate: invoiceEndDate.toISOString(),
        referenceMonth: month,
        referenceYear: year,
        dueDate: new Date(year, month -1, creditCard.due_day).toISOString(),
      },
      expenses: expenses,
      totalAmount: totalAmount,
    };
  }
}

module.exports = new DashboardService();