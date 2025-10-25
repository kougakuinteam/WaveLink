<?php
// 打开错误显示，方便调试
ini_set('display_errors', '1');
error_reporting(E_ALL);

// -----------------------------------------------------------------
// ！！！核心功能：根据房间号获取一个安全的日志文件名！！！
// -----------------------------------------------------------------
function getLogFileByRoom($roomName) {
    if (empty($roomName)) {
        $roomName = 'default_room'; // 默认房间
    }
    
    // 安全过滤：只允许 字母, 数字, 下划线_, 连字符-
    // 这可以防止黑客使用 '..' 或 '/' 来访问你服务器上的其他文件
    $safeRoomName = preg_replace('/[^a-zA-Z0-9_-]/', '', $roomName);

    if (empty($safeRoomName)) {
        $safeRoomName = 'default_room';
    }

    // 还是使用 /tmp 目录
    return sys_get_temp_dir() . '/' . $safeRoomName . '_chat.log';
}
// -----------------------------------------------------------------


// 简单的 JSON 响应函数
function json_resp($data, $code = 200) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

// ==============================
// 1. 处理 "获取" 消息的请求
// ==============================
if (isset($_GET['action']) && $_GET['action'] === 'get') {
    
    // 从 URL 参数获取房间号
    $room = $_GET['room'] ?? 'default_room';
    $logFile = getLogFileByRoom($room);

    if (!file_exists($logFile)) {
        json_resp([]); // 空数组
    }

    $fileLines = @file($logFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($fileLines === false) {
        error_log('chat_api.php: failed to read ' . $logFile);
        json_resp([], 500);
    }

    $messages = [];
    foreach ($fileLines as $line) {
        $data = json_decode($line, true);
        if ($data && is_array($data)) {
            $messages[] = $data;
        }
    }
    json_resp($messages);
}

// ==============================
// 2. 处理 "发送" 消息的请求
// ==============================
if (isset($_POST['action']) && $_POST['action'] === 'send') {
    
    // 从 POST 数据获取房间号
    $room = $_POST['room'] ?? 'default_room';
    $logFile = getLogFileByRoom($room);

    $nickname = trim((string)($_POST['nickname'] ?? '匿名'));
    $message  = trim((string)($_POST['message'] ?? ''));

    if ($message === '') {
        json_resp(['status' => 'error', 'message' => '消息不能为空'], 400);
    }

    $entry = [
        'time' => time(),
        'user' => $nickname === '' ? '匿名' : mb_substr($nickname, 0, 64),
        'msg'  => htmlspecialchars($message, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8')
    ];

    $jsonLine = json_encode($entry, JSON_UNESCAPED_UNICODE);
    if ($jsonLine === false) {
        error_log('chat_api.php: json_encode failed');
        json_resp(['status' => 'error', 'message' => 'internal json error'], 500);
    }

    $res = @file_put_contents($logFile, $jsonLine . PHP_EOL, FILE_APPEND | LOCK_EX);
    if ($res === false) {
        error_log('chat_api.php: failed to write ' . $logFile . ' (check /tmp permissions?)');
        json_resp(['status' => 'error', 'message' => 'failed to write log'], 500);
    }

    json_resp(['status' => 'ok']);
}

// 无效请求
json_resp(['status' => 'error', 'message' => '无效的请求'], 400);
?>
