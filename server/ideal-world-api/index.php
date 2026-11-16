<?php
declare(strict_types=1);

/* 理想的世界 · 草原云端存档 API
   运行环境：PHP 8 + PDO SQLite（无需额外依赖）
   数据目录：/www/wwwroot/ideal-world-data
*/

const DATA_DIR = '/www/wwwroot/ideal-world-data';
const DB_FILE = DATA_DIR . '/world.sqlite';
const SECRET_FILE = DATA_DIR . '/secret.key';
const MAX_BODY = 65536;
const MAX_SAVE = 49152;
const TOKEN_TTL = 2592000; // 30 天

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Auth-Token');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function out(int $code, array $payload): void
{
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(int $code, string $msg): void
{
    out($code, ['ok' => false, 'error' => $msg]);
}

function read_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false) fail(400, '读不到请求');
    if (strlen($raw) > MAX_BODY) fail(413, '请求太大');
    if ($raw === '') return [];
    $data = json_decode($raw, true);
    if (!is_array($data)) fail(400, '请求格式不对');
    return $data;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) return $pdo;
    if (!is_dir(DATA_DIR)) fail(503, '存档服务还没初始化');
    try {
        $pdo = new PDO('sqlite:' . DB_FILE, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $pdo->exec('PRAGMA journal_mode = WAL');
        $pdo->exec('PRAGMA synchronous = NORMAL');
        $pdo->exec('PRAGMA busy_timeout = 5000');
        $pdo->exec('PRAGMA foreign_keys = ON');
        $pdo->exec('CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            pass_hash TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            last_login_at INTEGER NOT NULL
        )');
        $pdo->exec('CREATE TABLE IF NOT EXISTS saves (
            user_id INTEGER PRIMARY KEY,
            rev INTEGER NOT NULL DEFAULT 0,
            data TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )');
        $pdo->exec('CREATE TABLE IF NOT EXISTS attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip TEXT NOT NULL,
            at INTEGER NOT NULL,
            ok INTEGER NOT NULL
        )');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_attempts_ip_at ON attempts(ip, at)');
    } catch (Throwable $e) {
        error_log('ideal-world db: ' . $e->getMessage());
        fail(500, '存档服务暂时不可用');
    }
    return $pdo;
}

function secret(): string
{
    static $secret = null;
    if (is_string($secret)) return $secret;
    if (!is_file(SECRET_FILE)) {
        $key = random_bytes(32);
        if (file_put_contents(SECRET_FILE, $key, LOCK_EX) === false) fail(500, '服务密钥写不进去');
        @chmod(SECRET_FILE, 0600);
    }
    $raw = file_get_contents(SECRET_FILE);
    if ($raw === false || strlen($raw) < 32) fail(500, '服务密钥不可用');
    $secret = $raw;
    return $secret;
}

function b64u(string $bin): string
{
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}

function unb64u(string $text): string
{
    $raw = base64_decode(strtr($text, '-_', '+/'), true);
    return $raw === false ? '' : $raw;
}

function token_for(int $uid): string
{
    $payload = b64u(json_encode(['u' => $uid, 'e' => time() + TOKEN_TTL], JSON_UNESCAPED_SLASHES));
    return $payload . '.' . b64u(hash_hmac('sha256', $payload, secret(), true));
}

function auth_uid(): int
{
    $token = '';
    if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
        $token = preg_replace('/^Bearer\s+/i', '', trim((string)$_SERVER['HTTP_AUTHORIZATION']));
    } elseif (!empty($_SERVER['HTTP_X_AUTH_TOKEN'])) {
        $token = trim((string)$_SERVER['HTTP_X_AUTH_TOKEN']);
    }
    if (!is_string($token) || !preg_match('/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/', $token)) {
        fail(401, '请先登录');
    }
    [$payload, $sig] = explode('.', $token, 2);
    $calc = b64u(hash_hmac('sha256', $payload, secret(), true));
    if (!hash_equals($calc, $sig)) fail(401, '登录已失效');
    $json = json_decode(unb64u($payload), true);
    if (!is_array($json) || !isset($json['u'], $json['e']) || (int)$json['e'] < time()) {
        fail(401, '登录已过期');
    }
    return (int)$json['u'];
}

function client_ip(): string
{
    return (string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
}

function rate_guard(): void
{
    $pdo = db();
    $ip = client_ip();
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM attempts WHERE ip = ? AND ok = 0 AND at >= ?');
    $stmt->execute([$ip, time() - 600]);
    if ((int)$stmt->fetchColumn() >= 20) fail(429, '尝试太频繁，请过几分钟再试');
    if (random_int(1, 200) === 1) {
        $pdo->prepare('DELETE FROM attempts WHERE at < ?')->execute([time() - 86400]);
    }
}

function log_attempt(bool $ok): void
{
    try {
        db()->prepare('INSERT INTO attempts (ip, at, ok) VALUES (?, ?, ?)')
            ->execute([client_ip(), time(), $ok ? 1 : 0]);
    } catch (Throwable $e) {
        // 记录失败不影响主流程
    }
}

function clean_username($value): string
{
    $name = is_string($value) ? trim($value) : '';
    if (!preg_match('/^[A-Za-z0-9_]{3,24}$/', $name)) {
        fail(400, '用户名要 3-24 位字母、数字或下划线');
    }
    return $name;
}

function clean_password($value): string
{
    $pass = is_string($value) ? $value : '';
    $len = strlen($pass);
    if ($len < 6 || $len > 64) fail(400, '密码要 6-64 位');
    return $pass;
}

function clean_save($value): string
{
    if (!is_string($value)) fail(400, '存档格式不对');
    if (strlen($value) > MAX_SAVE) fail(413, '存档太大');
    $data = json_decode($value, true);
    if (!is_array($data)) fail(400, '存档内容不是 JSON 对象');
    if (($data['v'] ?? 0) !== 1) fail(400, '存档版本不支持');
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) fail(400, '存档内容无法保存');
    return $json;
}

function save_row(int $uid): ?array
{
    $stmt = db()->prepare('SELECT rev, data, updated_at FROM saves WHERE user_id = ?');
    $stmt->execute([$uid]);
    $row = $stmt->fetch();
    if (!$row) return null;
    return [
        'rev' => (int)$row['rev'],
        'data' => json_decode((string)$row['data'], true),
        'updatedAt' => (int)$row['updated_at'],
    ];
}

try {
    $action = (string)($_GET['action'] ?? '');

    if ($action === 'health') {
        $pdo = db();
        $pdo->query('SELECT 1');
        out(200, ['ok' => true, 'time' => time()]);
    }

    if ($action === 'register') {
        rate_guard();
        $body = read_body();
        $name = clean_username($body['username'] ?? '');
        $pass = clean_password($body['password'] ?? '');
        $pdo = db();
        $stmt = $pdo->prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE');
        $stmt->execute([$name]);
        if ($stmt->fetch()) fail(409, '这个用户名已经被用了');
        $now = time();
        try {
            $stmt = $pdo->prepare('INSERT INTO users (username, pass_hash, created_at, last_login_at) VALUES (?, ?, ?, ?)');
            $stmt->execute([$name, password_hash($pass, PASSWORD_DEFAULT), $now, $now]);
        } catch (PDOException $e) {
            fail(409, '这个用户名已经被用了');
        }
        $uid = (int)$pdo->lastInsertId();
        log_attempt(true);
        out(200, [
            'ok' => true,
            'token' => token_for($uid),
            'username' => $name,
            'rev' => 0,
            'data' => null,
            'updatedAt' => 0,
        ]);
    }

    if ($action === 'login') {
        rate_guard();
        $body = read_body();
        $name = clean_username($body['username'] ?? '');
        $pass = clean_password($body['password'] ?? '');
        $pdo = db();
        $stmt = $pdo->prepare('SELECT id, username, pass_hash FROM users WHERE username = ? COLLATE NOCASE');
        $stmt->execute([$name]);
        $user = $stmt->fetch();
        if (!$user || !password_verify($pass, (string)$user['pass_hash'])) {
            log_attempt(false);
            usleep(250000);
            fail(401, '用户名或密码不对');
        }
        $uid = (int)$user['id'];
        $pdo->prepare('UPDATE users SET last_login_at = ? WHERE id = ?')->execute([time(), $uid]);
        log_attempt(true);
        $save = save_row($uid);
        out(200, [
            'ok' => true,
            'token' => token_for($uid),
            'username' => (string)$user['username'],
            'rev' => $save['rev'] ?? 0,
            'data' => $save['data'] ?? null,
            'updatedAt' => $save['updatedAt'] ?? 0,
        ]);
    }

    if ($action === 'load') {
        $uid = auth_uid();
        $save = save_row($uid);
        out(200, [
            'ok' => true,
            'rev' => $save['rev'] ?? 0,
            'data' => $save['data'] ?? null,
            'updatedAt' => $save['updatedAt'] ?? 0,
        ]);
    }

    if ($action === 'save') {
        $uid = auth_uid();
        $body = read_body();
        $revRaw = $body['rev'] ?? null;
        if (!is_int($revRaw) && !(is_string($revRaw) && ctype_digit($revRaw))) {
            fail(400, '缺少存档版本');
        }
        $rev = (int)$revRaw;
        if ($rev < 0) fail(400, '存档版本不对');
        $data = clean_save($body['data'] ?? '');
        $pdo = db();
        $pdo->exec('BEGIN IMMEDIATE');
        try {
            $stmt = $pdo->prepare('SELECT rev, data, updated_at FROM saves WHERE user_id = ?');
            $stmt->execute([$uid]);
            $row = $stmt->fetch();
            if ($row && (int)$row['rev'] !== $rev) {
                $pdo->exec('COMMIT');
                out(409, [
                    'ok' => false,
                    'error' => 'conflict',
                    'rev' => (int)$row['rev'],
                    'data' => json_decode((string)$row['data'], true),
                    'updatedAt' => (int)$row['updated_at'],
                ]);
            }
            $now = time();
            if (!$row) {
                $pdo->prepare('INSERT INTO saves (user_id, rev, data, updated_at) VALUES (?, 1, ?, ?)')
                    ->execute([$uid, $data, $now]);
                $newRev = 1;
            } else {
                $newRev = $rev + 1;
                $pdo->prepare('UPDATE saves SET rev = ?, data = ?, updated_at = ? WHERE user_id = ?')
                    ->execute([$newRev, $data, $now, $uid]);
            }
            $pdo->exec('COMMIT');
        } catch (Throwable $e) {
            $pdo->exec('ROLLBACK');
            throw $e;
        }
        out(200, ['ok' => true, 'rev' => $newRev, 'updatedAt' => $now]);
    }

    fail(404, '接口不存在');
} catch (Throwable $e) {
    error_log('ideal-world api: ' . $e->getMessage());
    fail(500, '服务器开小差了');
}
