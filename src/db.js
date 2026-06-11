const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');
const { hashSenha } = require('./auth');

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
const db = new DatabaseSync(config.databasePath);
db.exec('PRAGMA foreign_keys = ON');

function tableSql(name) {
  return db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name)?.sql || '';
}

function columns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((col) => col.name);
}

function ensureColumn(table, name, definition) {
  if (!columns(table).includes(name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

function migrateUsuariosProfileCheck() {
  const sql = tableSql('usuarios');
  if (!sql || sql.includes('supervisor')) return;
  db.exec(`
    ALTER TABLE usuarios RENAME TO usuarios_old;
    CREATE TABLE usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      nome_exibicao TEXT,
      matricula TEXT,
      setor TEXT,
      cargo TEXT,
      email TEXT NOT NULL UNIQUE,
      perfil TEXT NOT NULL CHECK (perfil IN ('administrador','producao','qualidade','supervisor','consulta_auditoria')),
      senha_hash TEXT NOT NULL,
      avatar_url TEXT,
      biometric_template_id TEXT,
      biometric_provider TEXT,
      digital_cadastrada INTEGER NOT NULL DEFAULT 0,
      ultimo_acesso TEXT,
      status TEXT NOT NULL DEFAULT 'ativo',
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO usuarios (id,nome,email,perfil,senha_hash,status,criado_em)
    SELECT id,nome,email,perfil,senha_hash,status,criado_em FROM usuarios_old;
    DROP TABLE usuarios_old;
  `);
}

function repairUsuarioForeignKeys() {
  if (tableSql('logs_acesso').includes('usuarios_old')) {
    db.exec(`
      ALTER TABLE logs_acesso RENAME TO logs_acesso_old;
      CREATE TABLE logs_acesso (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        usuario_nome TEXT,
        metodo TEXT NOT NULL,
        status TEXT NOT NULL,
        dispositivo TEXT,
        observacoes TEXT,
        criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO logs_acesso (id,usuario_id,usuario_nome,metodo,status,dispositivo,observacoes,criado_em)
      SELECT id,usuario_id,usuario_nome,metodo,status,dispositivo,observacoes,criado_em FROM logs_acesso_old;
      DROP TABLE logs_acesso_old;
    `);
  }

  if (tableSql('assinaturas_eletronicas').includes('usuarios_old')) {
    db.exec(`
      ALTER TABLE assinaturas_eletronicas RENAME TO assinaturas_eletronicas_old;
      CREATE TABLE assinaturas_eletronicas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        usuario_nome TEXT NOT NULL,
        perfil TEXT NOT NULL,
        acao TEXT NOT NULL,
        entidade TEXT,
        entidade_id TEXT,
        metodo TEXT NOT NULL,
        observacao TEXT,
        criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO assinaturas_eletronicas (id,usuario_id,usuario_nome,perfil,acao,entidade,entidade_id,metodo,observacao,criado_em)
      SELECT id,usuario_id,usuario_nome,perfil,acao,entidade,entidade_id,metodo,observacao,criado_em FROM assinaturas_eletronicas_old;
      DROP TABLE assinaturas_eletronicas_old;
    `);
  }
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      nome_exibicao TEXT,
      matricula TEXT,
      setor TEXT,
      cargo TEXT,
      email TEXT NOT NULL UNIQUE,
      perfil TEXT NOT NULL CHECK (perfil IN ('administrador','producao','qualidade','supervisor','consulta_auditoria')),
      senha_hash TEXT NOT NULL,
      avatar_url TEXT,
      biometric_template_id TEXT,
      biometric_provider TEXT,
      digital_cadastrada INTEGER NOT NULL DEFAULT 0,
      ultimo_acesso TEXT,
      status TEXT NOT NULL DEFAULT 'ativo',
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT NOT NULL UNIQUE,
      nome TEXT NOT NULL,
      volume_declarado_ml REAL NOT NULL,
      densidade_padrao REAL NOT NULL,
      variacao_percentual REAL NOT NULL,
      volume_minimo_ml REAL NOT NULL,
      volume_maximo_ml REAL NOT NULL,
      peso_bruto_minimo_g REAL NOT NULL,
      peso_bruto_maximo_g REAL NOT NULL,
      tipo_embalagem TEXT NOT NULL,
      quantidade_amostras INTEGER NOT NULL DEFAULT 10,
      status TEXT NOT NULL DEFAULT 'ativo',
      atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS embalagens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT NOT NULL UNIQUE,
      descricao TEXT NOT NULL,
      tipo TEXT NOT NULL,
      peso_medio_g REAL NOT NULL,
      unidade TEXT NOT NULL DEFAULT 'g',
      observacoes TEXT,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS maquinas_balancas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      linha TEXT NOT NULL,
      maquina_envase TEXT NOT NULL,
      tag_maquina TEXT NOT NULL,
      balanca TEXT NOT NULL,
      tag_balanca TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ativo',
      observacoes TEXT
    );

    CREATE TABLE IF NOT EXISTS cartas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE RESTRICT,
      lote TEXT NOT NULL,
      ordem_producao TEXT,
      volume_declarado_ml REAL NOT NULL,
      densidade REAL NOT NULL,
      variacao_percentual REAL NOT NULL,
      volume_minimo_ml REAL NOT NULL,
      volume_maximo_ml REAL NOT NULL,
      peso_bruto_minimo_g REAL NOT NULL,
      peso_bruto_maximo_g REAL NOT NULL,
      maquina_balanca_id INTEGER REFERENCES maquinas_balancas(id) ON DELETE SET NULL,
      maquina_envase TEXT,
      linha TEXT,
      balanca TEXT,
      data_abertura TEXT NOT NULL,
      responsavel_abertura TEXT NOT NULL,
      frequencia_minutos INTEGER NOT NULL DEFAULT 30,
      tolerancia_minutos INTEGER NOT NULL DEFAULT 10,
      quantidade_amostras INTEGER NOT NULL DEFAULT 10,
      observacoes TEXT,
      status TEXT NOT NULL DEFAULT 'aberta',
      justificativa TEXT,
      conferido_por TEXT,
      assinatura_responsavel TEXT,
      fechada_em TEXT
    );

    CREATE TABLE IF NOT EXISTS coletas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      carta_id INTEGER NOT NULL REFERENCES cartas(id) ON DELETE CASCADE,
      numero_coleta INTEGER NOT NULL,
      responsavel TEXT NOT NULL,
      data TEXT NOT NULL,
      hora TEXT NOT NULL,
      tara_embalagem_g REAL NOT NULL,
      pesos_brutos_json TEXT NOT NULL,
      resultado_json TEXT NOT NULL,
      status TEXT NOT NULL,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(carta_id, numero_coleta)
    );

    CREATE TABLE IF NOT EXISTS auditoria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER,
      usuario_nome TEXT,
      entidade TEXT NOT NULL,
      entidade_id TEXT NOT NULL,
      acao TEXT NOT NULL,
      valor_anterior TEXT,
      valor_novo TEXT,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS logs_acesso (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      usuario_nome TEXT,
      metodo TEXT NOT NULL,
      status TEXT NOT NULL,
      dispositivo TEXT,
      observacoes TEXT,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS assinaturas_eletronicas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      usuario_nome TEXT NOT NULL,
      perfil TEXT NOT NULL,
      acao TEXT NOT NULL,
      entidade TEXT,
      entidade_id TEXT,
      metodo TEXT NOT NULL,
      observacao TEXT,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS configuracoes (
      chave TEXT PRIMARY KEY,
      valor TEXT NOT NULL,
      atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_cartas_filtros ON cartas(produto_id, lote, status, data_abertura);
    CREATE INDEX IF NOT EXISTS idx_coletas_carta ON coletas(carta_id, numero_coleta);
    CREATE INDEX IF NOT EXISTS idx_auditoria_entidade ON auditoria(entidade, entidade_id);
    CREATE INDEX IF NOT EXISTS idx_logs_acesso_usuario ON logs_acesso(usuario_id, criado_em);
    CREATE INDEX IF NOT EXISTS idx_assinaturas_entidade ON assinaturas_eletronicas(entidade, entidade_id);
  `);

  migrateUsuariosProfileCheck();
  repairUsuarioForeignKeys();
  ensureColumn('usuarios', 'nome_exibicao', 'TEXT');
  ensureColumn('usuarios', 'matricula', 'TEXT');
  ensureColumn('usuarios', 'setor', 'TEXT');
  ensureColumn('usuarios', 'cargo', 'TEXT');
  ensureColumn('usuarios', 'avatar_url', 'TEXT');
  ensureColumn('usuarios', 'biometric_template_id', 'TEXT');
  ensureColumn('usuarios', 'biometric_provider', 'TEXT');
  ensureColumn('usuarios', 'digital_cadastrada', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('usuarios', 'ultimo_acesso', 'TEXT');

  const count = db.prepare('SELECT COUNT(*) AS total FROM usuarios').get().total;
  if (count === 0) {
    db.prepare('INSERT INTO usuarios (nome,nome_exibicao,matricula,setor,cargo,email,perfil,senha_hash) VALUES (?,?,?,?,?,?,?,?)')
      .run('Administrador', 'Admin', 'ADM-001', 'TI', 'Administrador do sistema', 'admin@sobral.local', 'administrador', hashSenha('admin123'));
    db.prepare('INSERT INTO usuarios (nome,nome_exibicao,matricula,setor,cargo,email,perfil,senha_hash) VALUES (?,?,?,?,?,?,?,?)')
      .run('Operador Producao', 'Producao', 'PROD-001', 'Producao', 'Operador de envase', 'producao@sobral.local', 'producao', hashSenha('producao123'));
    db.prepare('INSERT INTO usuarios (nome,nome_exibicao,matricula,setor,cargo,email,perfil,senha_hash) VALUES (?,?,?,?,?,?,?,?)')
      .run('Qualidade', 'Qualidade', 'QUA-001', 'Qualidade', 'Analista de qualidade', 'qualidade@sobral.local', 'qualidade', hashSenha('qualidade123'));
    db.prepare('INSERT INTO usuarios (nome,nome_exibicao,matricula,setor,cargo,email,perfil,senha_hash) VALUES (?,?,?,?,?,?,?,?)')
      .run('Supervisor Producao', 'Supervisor', 'SUP-001', 'Producao', 'Supervisor de producao', 'supervisor@sobral.local', 'supervisor', hashSenha('supervisor123'));
  }

  db.exec(`
    UPDATE usuarios SET nome_exibicao = COALESCE(nome_exibicao, nome);
    UPDATE usuarios SET setor = COALESCE(setor,
      CASE perfil
        WHEN 'administrador' THEN 'Administracao'
        WHEN 'producao' THEN 'Producao'
        WHEN 'supervisor' THEN 'Producao'
        WHEN 'qualidade' THEN 'Qualidade'
        ELSE 'Auditoria'
      END
    );
    UPDATE usuarios SET cargo = COALESCE(cargo,
      CASE perfil
        WHEN 'administrador' THEN 'Administrador'
        WHEN 'producao' THEN 'Operador'
        WHEN 'supervisor' THEN 'Supervisor'
        WHEN 'qualidade' THEN 'Qualidade'
        ELSE 'Consulta'
      END
    );
  `);

  const produtos = db.prepare('SELECT COUNT(*) AS total FROM produtos').get().total;
  if (produtos === 0) {
    db.prepare(`
      INSERT INTO produtos
      (codigo,nome,volume_declarado_ml,densidade_padrao,variacao_percentual,volume_minimo_ml,volume_maximo_ml,peso_bruto_minimo_g,peso_bruto_maximo_g,tipo_embalagem,quantidade_amostras)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run('AGL-200', 'Agualema Sobral 200 mL', 200, 1.0126, 1, 200, 202, 228.59, 230.62, 'Frasco 200 mL + tampa + lacre', 10);
  }

  const maquinas = db.prepare('SELECT COUNT(*) AS total FROM maquinas_balancas').get().total;
  if (maquinas === 0) {
    db.prepare(`
      INSERT INTO maquinas_balancas (linha,maquina_envase,tag_maquina,balanca,tag_balanca,status,observacoes)
      VALUES (?,?,?,?,?,?,?)
    `).run('1', 'ECH-501013', 'ECH-501013', 'BAL-501004', 'BAL-501004', 'ativo', 'Exemplo inicial');
  }

  run('INSERT OR IGNORE INTO configuracoes (chave,valor) VALUES (?,?)', ['bloqueio_automatico_minutos', '15']);
}

function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}

function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

function auditar(usuario, entidade, entidadeId, acao, anterior, novo) {
  run(
    'INSERT INTO auditoria (usuario_id,usuario_nome,entidade,entidade_id,acao,valor_anterior,valor_novo) VALUES (?,?,?,?,?,?,?)',
    [
      usuario?.id || null,
      usuario?.nome || 'sistema',
      entidade,
      String(entidadeId),
      acao,
      anterior ? JSON.stringify(anterior) : null,
      novo ? JSON.stringify(novo) : null,
    ],
  );
}

function registrarAcesso(usuario, metodo, status, dispositivo, observacoes = '') {
  run(
    'INSERT INTO logs_acesso (usuario_id,usuario_nome,metodo,status,dispositivo,observacoes) VALUES (?,?,?,?,?,?)',
    [usuario?.id || null, usuario?.nome || null, metodo, status, dispositivo || '', observacoes],
  );
  if (usuario?.id && status === 'sucesso') {
    run('UPDATE usuarios SET ultimo_acesso = CURRENT_TIMESTAMP WHERE id = ?', [usuario.id]);
  }
}

function registrarAssinatura(usuario, acao, entidade, entidadeId, metodo, observacao = '') {
  run(
    'INSERT INTO assinaturas_eletronicas (usuario_id,usuario_nome,perfil,acao,entidade,entidade_id,metodo,observacao) VALUES (?,?,?,?,?,?,?,?)',
    [usuario.id, usuario.nome, usuario.perfil, acao, entidade || '', entidadeId ? String(entidadeId) : '', metodo, observacao],
  );
}

module.exports = { db, migrate, all, get, run, auditar, registrarAcesso, registrarAssinatura };
