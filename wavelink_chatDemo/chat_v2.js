document.addEventListener('DOMContentLoaded', () => {
    
    console.log('chat_v2.js (多房间版) 已加载！');

    // --- 视图 ---
    const loginView = document.getElementById('login-view');
    const chatView = document.getElementById('chat-view');
    
    // --- 登录元素 ---
    const joinButton = document.getElementById('join-button');
    const nicknameInput = document.getElementById('nickname-input');
    const roomIdInput = document.getElementById('room-id-input'); // 新增！

    // --- 聊天元素 ---
    const chatBox = document.getElementById('chat-box');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const roomTitle = document.getElementById('room-title'); // 新增！

    let myNickname = '';
    let myRoomId = ''; // 新增！
    let messageInterval;

    
    //
    function checkUrlForRoom() {
        const params = new URLSearchParams(window.location.search);
        const roomFromUrl = params.get('room'); // 检查 ?room=...
        if (roomFromUrl) {
            console.log('在 URL 中找到了房间号:', roomFromUrl);
            roomIdInput.value = roomFromUrl; // 自动填入输入框
        }
    }
    
    // 页面加载时，立刻检查 URL
    checkUrlForRoom();

    // 1. 加入聊天
    joinButton.onclick = () => {
        console.log('"加入聊天" 按钮被点击！');
        
        const nickname = nicknameInput.value.trim();
        const room = roomIdInput.value.trim();

        if (nickname.length === 0 || room.length === 0) {
            alert('房间号和昵称都不能为空！');
            return;
        }

        myNickname = nickname;
        myRoomId = room; // 保存房间号
        
        loginView.style.display = 'none';
        chatView.style.display = 'flex'; // (注意：是 flex)
        roomTitle.textContent = `房间: ${myRoomId}`; // 显示房间标题
        
        console.log(`登录成功 (房间: ${myRoomId}, 昵称: ${myNickname})，开始获取消息...`);
        
        // 停止之前的轮询 (如果有的话)
        if (messageInterval) clearInterval(messageInterval);
        
        // 开始每 2 秒获取一次新消息
        messageInterval = setInterval(getMessages, 2000);
        getMessages(); // 立即获取一次
    };

    // 2. 发送消息
    sendButton.onclick = async () => {
        const message = messageInput.value.trim();
        if (message.length === 0) return;

        const formData = new FormData();
        formData.append('action', 'send');
        formData.append('room', myRoomId); // 必须发送房间号
        formData.append('nickname', myNickname);
        formData.append('message', message);

        try {
            await fetch('chat_api.php', {
                method: 'POST',
                body: formData
            });
            messageInput.value = '';
            getMessages(); 
        } catch (e) {
            console.error('发送失败', e);
        }
    };
    
    messageInput.onkeydown = (e) => {
        if (e.key === 'Enter') sendButton.click();
    };

    // 3. 获取消息
    async function getMessages() {
        if (myRoomId === '') return; // 如果没有房间号，就停止

        try {
            // ！！！！！！
            // 像你的例子一样，把房间号作为“参数”发给服务器
            const response = await fetch(`chat_api.php?action=get&room=${myRoomId}`);
            // ！！！！！！

            const messages = await response.json(); 

            chatBox.innerHTML = ''; 
            
            for (const msg of messages) {
                const msgElement = document.createElement('div');
                msgElement.className = 'msg';
                if (msg.user === myNickname) {
                    msgElement.classList.add('from-me');
                }
                msgElement.innerHTML = `<strong>${msg.user}:</strong> <span>${msg.msg}</span>`;
                chatBox.appendChild(msgElement);
            }
            chatBox.scrollTop = chatBox.scrollHeight;
        } catch (e) {
            // (轮询时的小错误不打印，避免刷屏)
        }
    }
});
