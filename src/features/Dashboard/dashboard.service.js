// src/features/Dashboard/dashboard.service.js
const { Expense, Category, Revenue, MonthlyGoal, CreditCard, sequelize } = require('../../models'); // <<< MODIFICADO: Adicionado CreditCard
const { Op } = require('sequelize');
const { parseISO, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear, subDays, eachDayOfInterval, format, addMonths } = require('date-fns'); // <<< MODIFICADO: addMonths

class DashboardService {

  // ===================================================================
  // 1. ENDPOINT DE KPIs (NÚMEROS PRINCIPAIS) - COM ALERTA DE META
  // ===================================================================
  async getKPIs(filters, profileId) {
    if (!profileId) throw new Error('ID do Perfil é obrigatório.');
      
    const { whereClause: expenseWhere } = this._buildWhereClause(filters, 'expense'); // <<< MODIFICADO: Passa 'expense'
    
    // Sobrescreve o período para o MÊS CORRENTE para o cálculo da meta
    const now = new Date();
    const startOfCurrentMonth = startOfMonth(now);
    const endOfCurrentMonth = endOfMonth(now);
    
    const monthlyExpenseWhere = { 
        profile_id: profileId,
        // Garante que o cálculo da meta use expense_date, ou charge_date se for cartão
        [Op.or]: [
            { expense_date: { [Op.between]: [startOfCurrentMonth, endOfCurrentMonth] } },
            { charge_date: { [Op.between]: [startOfCurrentMonth, endOfCurrentMonth] } }
        ],
        is_installment: { [Op.ne]: true } // Considera apenas a despesa original para KPIs
    };
    
    // --- Cálculo de KPIs (baseado no filtro fornecido) ---
    expenseWhere.profile_id = profileId;
    // Exclui parcelas subsequentes de serem contadas como despesas individuais para KPIs
    expenseWhere.original_expense_id = { [Op.eq]: null }; 

    const revenueWhere = { profile_id: profileId };
    if (expenseWhere.expense_date) { // Se o filtro tem data, aplica em receita
        revenueWhere.revenue_date = expenseWhere.expense_date;
    }
    // <<< NOVO: Se o filtro de despesa usa charge_date, ajusta para revenue_date >>>
    else if (expenseWhere.charge_date) {
        revenueWhere.revenue_date = expenseWhere.charge_date; // Heurística, pode ser mais sofisticado
    }
    // <<< FIM NOVO >>>

    const totalExpenses = await Expense.sum('value', { where: expenseWhere });
    const totalRevenues = await Revenue.sum('value', { where: revenueWhere });

    // <<< MODIFICADO: As categorias devem ser filtradas por category_flow 'expense' >>>
    const expensesByCategory = await Expense.findAll({
        where: expenseWhere,
        attributes: [
            [sequelize.fn('SUM', sequelize.col('Expense.value')), 'total'],
        ],
        include: [{ model: Category, as: 'category', attributes: ['name', 'category_flow'], where: { category_flow: 'expense' } }],
        group: ['category.id', 'category.name'],
        order: [[sequelize.fn('SUM', sequelize.col('Expense.value')), 'DESC']],
        limit: 1,
        raw: true
    });
    // <<< FIM MODIFICADO >>>

    const highestCategory = expensesByCategory.length > 0 ? {
        name: expensesByCategory[0]['category.name'],
        total: parseFloat(expensesByCategory[0].total)
    } : { name: 'N/A', total: 0 };
    
    // --- Lógica de Meta Mensal (baseado no MÊS CORRENTE) ---
    // Usar a mesma lógica de data da consulta principal para a meta
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

    const { whereClause: expenseWhere, startDate, endDate } = this._buildWhereClause(filters, 'expense'); // <<< MODIFICADO
    expenseWhere.profile_id = profileId; // FILTRO POR PERFIL
    expenseWhere.original_expense_id = { [Op.eq]: null }; // Ignora parcelas para gráficos de distribuição
    
    const { whereClause: revenueWhere } = this._buildWhereClause(filters, 'revenue'); // <<< NOVO
    revenueWhere.profile_id = profileId;

    // <<< MODIFICADO: expensesByCategory para filtrar por category_flow 'expense' >>>
    const expensesByCategory = await Expense.findAll({
      where: expenseWhere,
      attributes: [
        'category.name',
        [sequelize.fn('SUM', sequelize.col('Expense.value')), 'total'],
      ],
      include: [{ model: Category, as: 'category', attributes: [], where: { category_flow: 'expense' } }],
      group: ['category.name'],
      raw: true,
    });
    // <<< FIM MODIFICADO >>>
    
    // <<< NOVO: revenuesByCategory para filtrar por category_flow 'revenue' >>>
    const revenuesByCategory = await Revenue.findAll({
        where: revenueWhere,
        attributes: [
            'category.name',
            [sequelize.fn('SUM', sequelize.col('Revenue.value')), 'total'],
        ],
        include: [{ model: Category, as: 'category', attributes: [], where: { category_flow: 'revenue' } }],
        group: ['category.name'],
        raw: true,
    });
    // <<< FIM NOVO >>>

    // <<< NOVO: expensesByType para agrupar por tipo de categoria de despesa >>>
    const expensesByType = await Expense.findAll({
        where: expenseWhere,
        attributes: [
            'category.type',
            [sequelize.fn('SUM', sequelize.col('Expense.value')), 'total'],
        ],
        include: [{ model: Category, as: 'category', attributes: [], where: { category_flow: 'expense' } }],
        group: ['category.type'],
        raw: true,
    });
    // <<< FIM NOVO >>>


    const dailyExpenses = await Expense.findAll({
      where: expenseWhere,
      attributes: [
        [sequelize.fn('DATE', sequelize.col('Expense.charge_date')), 'date'], // Usa charge_date se disponível
        [sequelize.fn('SUM', sequelize.col('Expense.value')), 'total'],
      ],
      group: [sequelize.fn('DATE', sequelize.col('Expense.charge_date'))],
      order: [[sequelize.fn('DATE', sequelize.col('Expense.charge_date')), 'ASC']],
      raw: true
    });
    // Corrigir dataKey se for nula
    const formattedDailyExpenses = dailyExpenses.map(item => ({
        date: item.date || format(item.expense_date, 'yyyy-MM-dd'), // Fallback para expense_date
        total: parseFloat(item.total)
    }));


    const evolution = this._fillMissingDays(formattedDailyExpenses, startDate, endDate);

    return {
      pieChart: expensesByCategory.map(item => ({ name: item.name, value: parseFloat(item.total) })),
      // <<< NOVO: Adicionado pieChartByType >>>
      pieChartByType: expensesByType.map(item => ({ name: item.type, value: parseFloat(item.total) })),
      // <<< FIM NOVO >>>
      lineChart: {
        labels: evolution.map(item => item.date),
        data: evolution.map(item => item.total)
      },
      // TODO: Adicionar um gráfico de Receitas x Despesas ao longo do tempo (lineChart combinado)
      // TODO: Adicionar um gráfico de pizza para receitas por categoria
    };
  }

  // ===================================================================
  // 3. ENDPOINT PARA RELATÓRIOS (LISTA DETALHADA COM FILTROS)
  // ===================================================================
  // <<< MODIFICADO: getDetailedExpenses agora usa charge_date >>>
  async getDetailedExpenses(filters, profileId) {
    if (!profileId) throw new Error('ID do Perfil é obrigatório.');
      
    const { whereClause, limit, offset } = this._buildWhereClause(filters, 'expense'); // <<< MODIFICADO
    whereClause.profile_id = profileId; // FILTRO POR PERFIL

    const { count, rows } = await Expense.findAndCountAll({
      where: whereClause,
      include: [
        { model: Category, as: 'category', attributes: ['id', 'name', 'type', 'category_flow'] }, // Inclui category_flow
        { model: CreditCard, as: 'creditCard', attributes: ['id', 'name', 'last_four_digits'] }, // Inclui CreditCard
        { model: Expense, as: 'originalExpense', attributes: ['id', 'description', 'value'] } // Para parcelas
      ],
      order: [['charge_date', 'DESC'], ['expense_date', 'DESC']], // Orderna por charge_date primário
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
  // <<< FIM MODIFICADO >>>
  
  // <<< NOVO: getDetailedRevenues >>>
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
  // <<< FIM NOVO >>>

  // <<< MODIFICADO: getAllExpenses para incluir CreditCard e Parcelas >>>
  async getAllExpenses(profileId) {
    if (!profileId) throw new Error('ID do Perfil é obrigatório.');
      
    return Expense.findAll({
      where: { profile_id: profileId }, // FILTRO POR PERFIL
      include: [
        { model: Category, as: 'category', attributes: ['name', 'type', 'category_flow'] },
        { model: CreditCard, as: 'creditCard', attributes: ['name', 'last_four_digits'] },
        { model: Expense, as: 'originalExpense', attributes: ['id', 'description', 'value'] }
      ],
      order: [['charge_date', 'DESC'], ['expense_date', 'DESC']],
    });
  }
  // <<< FIM MODIFICADO >>>
  
  // <<< NOVO: getAllRevenues >>>
  async getAllRevenues(profileId) {
    if (!profileId) throw new Error('ID do Perfil é obrigatório.');
      
    return Revenue.findAll({
      where: { profile_id: profileId },
      include: [{ model: Category, as: 'category', attributes: ['name', 'type', 'category_flow'] }],
      order: [['revenue_date', 'DESC']],
    });
  }
  // <<< FIM NOVO >>>

  // ===================================================================
  // 4. ENDPOINTS CRUD (CRIAR, ATUALIZAR, DELETAR)
  // ===================================================================
  // <<< MODIFICADO: updateExpense para lidar com parcelas >>>
  async updateExpense(id, data, profileId) {
    const expense = await Expense.findOne({ where: { id, profile_id: profileId } });
    if (!expense) throw new Error('Despesa não encontrada ou não pertence ao perfil');

    // Se for uma parcela e tentar alterar valor/parcelas, deve-se avisar
    if (expense.original_expense_id && (data.value || data.total_installments || data.is_installment)) {
        throw new Error('Não é permitido alterar valor ou dados de parcelamento diretamente em uma parcela. Edite a despesa original.');
    }
    
    await expense.update(data);
    return expense;
  }
  // <<< FIM MODIFICADO >>>
  
  // <<< MODIFICADO: deleteExpense para lidar com parcelas >>>
  async deleteExpense(id, profileId) {
    const expense = await Expense.findOne({ where: { id, profile_id: profileId } });
    if (!expense) throw new Error('Despesa não encontrada ou não pertence ao perfil');

    // Se for uma despesa original com parcelas, deleta todas as parcelas
    if (expense.is_installment && expense.total_installments > 1) {
        await Expense.destroy({ where: { original_expense_id: expense.id, profile_id: profileId } });
    }
    await expense.destroy();
    return { message: 'Despesa e suas parcelas (se houver) deletadas com sucesso.' };
  }
  // <<< FIM MODIFICADO >>>
  
  async createRevenue(data, profileId) {
    if (!profileId) throw new Error('ID do Perfil é obrigatório.');
    
    const category = await Category.findByPk(data.category_id);
    if (!category || category.profile_id !== profileId || category.category_flow !== 'revenue') {
        throw new Error('Categoria de receita inválida ou não pertence a este perfil.');
    }

    return Revenue.create({ ...data, profile_id: profileId });
  }

  // <<< NOVO: updateRevenue >>>
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
  // <<< FIM NOVO >>>

  // <<< NOVO: deleteRevenue >>>
  async deleteRevenue(id, profileId) {
    const revenue = await Revenue.findOne({ where: { id, profile_id: profileId } });
    if (!revenue) throw new Error('Receita não encontrada ou não pertence ao perfil');
    await revenue.destroy();
    return { message: 'Receita deletada com sucesso.' };
  }
  // <<< FIM NOVO >>>

  // ===================================================================
  // LÓGICA INTERNA DE FILTROS (MUITO PODEROSA)
  // <<< MODIFICADO: _buildWhereClause para lidar com charge_date e flow >>>
  // ===================================================================
  _buildWhereClause(filters, flowType = 'expense') { // flowType: 'expense' ou 'revenue'
    const whereClause = {};
    let startDate, endDate;

    // A data principal a ser filtrada (expense_date ou revenue_date)
    const dateField = flowType === 'expense' ? 'expense_date' : 'revenue_date';
    const chargeDateField = 'charge_date'; // Campo específico para despesas de cartão

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
        // Para despesas, busca tanto em expense_date quanto em charge_date
        if (flowType === 'expense') {
            whereClause[Op.or] = [
                { [dateField]: { [Op.between]: [startDate, endDate] } },
                { [chargeDateField]: { [Op.between]: [startDate, endDate] } }
            ];
        } else { // Para receitas, usa apenas revenue_date
            whereClause[dateField] = { [Op.between]: [startDate, endDate] };
        }
    }
    // Para despesas, queremos apenas as "despesas originais" para evitar duplicidade de parcelas em relatórios
    if (flowType === 'expense') {
        whereClause.original_expense_id = { [Op.eq]: null }; 
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
    
    // <<< NOVO: Filtro por CreditCardId >>>
    if (flowType === 'expense' && filters.creditCardId) {
        whereClause.credit_card_id = filters.creditCardId;
    }
    // <<< FIM NOVO >>>

    const page = parseInt(filters.page, 10) || 1;
    const limit = parseInt(filters.limit, 10) || 20;
    const offset = (page - 1) * limit;

    return { whereClause, limit, offset, startDate, endDate };
  }
  // <<< FIM MODIFICADO >>>

  // <<< MODIFICADO: _fillMissingDays para usar o dateField correto (charge_date para despesa) >>>
  _fillMissingDays(data, startDate, endDate) {
    // Garante que o campo 'date' exista e seja formatado corretamente
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
  // <<< FIM MODIFICADO >>>

  // <<< NOVO: getCreditCardInvoice - Lógica para simular uma fatura de cartão >>>
  async getCreditCardInvoice(profileId, creditCardId, month, year) {
    if (!profileId || !creditCardId || !month || !year) {
      throw new Error('ID do Perfil, ID do Cartão, Mês e Ano são obrigatórios.');
    }

    const creditCard = await CreditCard.findByPk(creditCardId, { where: { profile_id: profileId } });
    if (!creditCard) {
      throw new Error('Cartão de crédito não encontrado.');
    }

    // Calcular o período de fechamento da fatura
    // A fatura de "Referência: Mês/Ano" é para despesas que caem nela.
    // Ex: Se closing_day = 10, e vence em 20.
    // Fatura de OUTUBRO/2025 (vencimento 20/OUT)
    // Coleta despesas do dia 11 de SETEMBRO até o dia 10 de OUTUBRO.

    // A lógica abaixo considera:
    // nextClosingDay: dia de fechamento do MÊS DE REFERÊNCIA da fatura (ex: 10 de Outubro)
    // previousClosingDay: dia de fechamento do mês anterior (ex: 10 de Setembro)
    
    let invoiceEndDate = new Date(year, month - 1, creditCard.closing_day); // Mês é 0-index no JS
    let invoiceStartDate = addMonths(invoiceEndDate, -1);
    invoiceStartDate.setDate(creditCard.closing_day + 1); // Começa um dia depois do fechamento anterior
    
    // Ajuste para datas válidas (ex: dia 31 em fevereiro)
    if (invoiceStartDate.getDate() !== (creditCard.closing_day + 1)) {
        invoiceStartDate = startOfMonth(addMonths(invoiceEndDate, -1)); // Começa no primeiro dia do mês anterior se o dia de fechamento for maior que os dias do mês
        invoiceStartDate.setDate(creditCard.closing_day + 1);
    }
    if (invoiceEndDate.getDate() !== creditCard.closing_day) {
        invoiceEndDate = endOfMonth(new Date(year, month - 1, 1)); // Vai para o último dia do mês se o dia de fechamento não existir
    }


    invoiceEndDate = endOfDay(invoiceEndDate); // Inclui o dia inteiro
    invoiceStartDate = startOfDay(invoiceStartDate); // Inclui o dia inteiro

    logger.info(`[CreditCardService] Buscando fatura para ${creditCard.name} (${month}/${year}). Período: ${invoiceStartDate.toISOString()} a ${invoiceEndDate.toISOString()}`);


    // Busca todas as despesas vinculadas ao cartão que caem nesse período de fatura
    const expenses = await Expense.findAll({
      where: {
        profile_id: profileId,
        credit_card_id: creditCardId,
        charge_date: { [Op.between]: [invoiceStartDate, invoiceEndDate] }, // Filtra pela charge_date
      },
      include: [
        { model: Category, as: 'category', attributes: ['name', 'category_flow'] },
        { model: Expense, as: 'originalExpense', attributes: ['id', 'description', 'value', 'total_installments'] } // Para parcelas
      ],
      order: [['charge_date', 'ASC'], ['expense_date', 'ASC']],
    });

    // Calcula o total da fatura
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
        dueDate: new Date(year, month -1, creditCard.due_day).toISOString(), // Vencimento no mês da referência
      },
      expenses: expenses,
      totalAmount: totalAmount,
    };
  }
  // <<< FIM NOVO >>>
}

module.exports = new DashboardService();