const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');
const { hashSenha } = require('./auth');

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
const db = new DatabaseSync(config.databasePath);
db.exec('PRAGMA foreign_keys = ON');

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      perfil TEXT NOT NULL CHECK (perfil IN ('administrador','producao','qualidade')),
      senha_hash TEXT NOT NULL,
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

    CREATE INDEX IF NOT EXISTS idx_cartas_filtros ON cartas(produto_id, lote, status, data_abertura);
    CREATE INDEX IF NOT EXISTS idx_coletas_carta ON coletas(carta_id, numero_coleta);
    CREATE INDEX IF NOT EXISTS idx_auditoria_entidade ON auditoria(entidade, entidade_id);
  `);

  const count = db.prepare('SELECT COUNT(*) AS total FROM usuarios').get().total;
  if (count === 0) {
    db.prepare('INSERT INTO usuarios (nome,email,perfil,senha_hash) VALUES (?,?,?,?)')
      .run('Administrador', 'admin@sobral.local', 'administrador', hashSenha('admin123'));
    db.prepare('INSERT INTO usuarios (nome,email,perfil,senha_hash) VALUES (?,?,?,?)')
      .run('Produção', 'producao@sobral.local', 'producao', hashSenha('producao123'));
    db.prepare('INSERT INTO usuarios (nome,email,perfil,senha_hash) VALUES (?,?,?,?)')
      .run('Qualidade', 'qualidade@sobral.local', 'qualidade', hashSenha('qualidade123'));
  }

  const produtos = db.prepare('SELECT COUNT(*) AS total FROM produtos').get().total;
  if (produtos === 0) {
    db.prepare(`
      INSERT INTO produtos
      (codigo,nome,volume_declarado_ml,densidade_padrao,variacao_percentual,volume_minimo_ml,volume_maximo_ml,peso_bruto_minimo_g,peso_bruto_maximo_g,tipo_embalagem,quantidade_amostras)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run('AGL-200', 'Agualemã Sobral 200 mL', 200, 1.0126, 1, 200, 202, 228.59, 230.62, 'Frasco 200 mL + tampa + lacre', 10);
  }

  const maquinas = db.prepare('SELECT COUNT(*) AS total FROM maquinas_balancas').get().total;
  if (maquinas === 0) {
    db.prepare(`
      INSERT INTO maquinas_balancas (linha,maquina_envase,tag_maquina,balanca,tag_balanca,status,observacoes)
      VALUES (?,?,?,?,?,?,?)
    `).run('1', 'ECH-501013', 'ECH-501013', 'BAL-501004', 'BAL-501004', 'ativo', 'Exemplo inicial');
  }
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

module.exports = { db, migrate, all, get, run, auditar };
