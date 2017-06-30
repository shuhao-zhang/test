// Exec implements the ast.Statement Exec interface.
// This function builds an Executor from a plan. If the Executor doesn't return result,
// like the INSERT, UPDATE statements, it executes in this function, if the Executor returns
// result, execution is done after this function returns, in the returned ast.RecordSet Next method.
func (a *statement) Exec(ctx context.Context) (ast.RecordSet, error) {
	a.startTime = time.Now()
	a.ctx = ctx
	if _, ok := a.plan.(*plan.Execute); !ok {
		// Do not sync transaction for Execute statement, because the real optimization work is done in
		// "ExecuteExec.Build".
		var err error
		if IsPointGetWithPKOrUniqueKeyByAutoCommit(ctx, a.plan) {
			log.Debugf("[%d][InitTxnWithStartTS] %s", ctx.GetSessionVars().ConnectionID, a.text)
			err = ctx.InitTxnWithStartTS(math.MaxUint64)
		} else {
			log.Debugf("[%d][ActivePendingTxn] %s", ctx.GetSessionVars().ConnectionID, a.text)
			err = ctx.ActivePendingTxn()
		}
		if err != nil {
			return nil, errors.Trace(err)
		}
	}

	b := newExecutorBuilder(ctx, a.is)
	e := b.build(a.plan)
	if b.err != nil {
		return nil, errors.Trace(b.err)
	}

	// ExecuteExec is not a real Executor, we only use it to build another Executor from a prepared statement.
	if executorExec, ok := e.(*ExecuteExec); ok {
		err := executorExec.Build()
		if err != nil {
			return nil, errors.Trace(err)
		}
		a.text = executorExec.Stmt.Text()
		a.isPreparedStmt = true
		a.plan = executorExec.Plan
		e = executorExec.StmtExec
	}

	err := e.Open()
	if err != nil {
		return nil, errors.Trace(err)
	}

	var pi processinfoSetter
	if raw, ok := ctx.(processinfoSetter); ok {
		pi = raw
		// Update processinfo, ShowProcess() will use it.
		pi.SetProcessInfo(a.OriginText())
	}

	// Fields or Schema are only used for statements that return result set.
	if e.Schema().Len() == 0 {
		// Check if "tidb_snapshot" is set for the write executors.
		// In history read mode, we can not do write operations.
		switch e.(type) {
		case *DeleteExec, *InsertExec, *UpdateExec, *ReplaceExec, *LoadData, *DDLExec:
			snapshotTS := ctx.GetSessionVars().SnapshotTS
			if snapshotTS != 0 {
				return nil, errors.New("can not execute write statement when 'tidb_snapshot' is set")
			}
		}

		defer func() {
			if pi != nil {
				pi.SetProcessInfo("")
			}
			e.Close()
			a.logSlowQuery()
		}()
		for {
			row, err := e.Next()
			if err != nil {
				return nil, errors.Trace(err)
			}
			// Even though there isn't any result set, the row is still used to indicate if there is
			// more work to do.
			// For example, the UPDATE statement updates a single row on a Next call, we keep calling Next until
			// There is no more rows to update.
			if row == nil {
				return nil, nil
			}
		}
	}

	return &recordSet{
		executor:    e,
		stmt:        a,
		processinfo: pi,
	}, nil
}
