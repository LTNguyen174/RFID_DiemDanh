import { useState } from 'react';
import { format } from 'date-fns';

interface ChatMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  sql?: string;
  fileUrl?: string;
  filename?: string;
}

interface FloatingChatBoxProps {
  className?: string;
}

export default function FloatingChatBox({ className }: FloatingChatBoxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const isLikelyReportRequest = (question: string) => {
    const normalized = question.toLowerCase();
    return [
      'báo cáo',
      'bao cao',
      'report',
      'xuất file',
      'xuat file',
      'xlsx'
    ].some((keyword) => normalized.includes(keyword));
  };
  
  const handleSend = async () => {
    if (!input.trim()) return;
    
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'user',
      content: input,
      timestamp: new Date()
    };
    
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    
    const timeoutMs = isLikelyReportRequest(input) ? 180000 : 30000;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      const controller = new AbortController();
      setAbortController(controller);
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      const response = await fetch('http://localhost:8000/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(localStorage.getItem('access_token')
            ? { Authorization: `Bearer ${localStorage.getItem('access_token')}` }
            : {})
        },
        body: JSON.stringify({ question: input }),
        signal: controller.signal
      });
      
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      setAbortController(null);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        const assistantMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          type: 'assistant',
          content: data.answer,
          timestamp: new Date(),
          fileUrl: data.file_url,
          filename: data.filename
        };
        setMessages(prev => [...prev, assistantMessage]);
        
        if (!isOpen) {
          setUnreadCount(prev => prev + 1);
        }
      } else {
        const errorMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          type: 'assistant',
          content: data.error || 'Xin lỗi, đã có lỗi xảy ra. Vui lòng thử lại.',
          timestamp: new Date()
        };
        setMessages(prev => [...prev, errorMessage]);
      }
    } catch (error) {
      console.error('Chat error:', error);
      let errorMessage = 'Không thể kết nối đến server. Vui lòng kiểm tra kết nối.';
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          const timeoutText = Math.round(timeoutMs / 1000);
          errorMessage = `⏱️ Yêu cầu đã bị hủy hoặc quá thời gian chờ (${timeoutText}s). Vui lòng thử lại.`;
        } else if (error.message.includes('Failed to fetch')) {
          errorMessage = '🔴 Không kết nối được đến server. Vui lòng kiểm tra lại kết nối mạng hoặc thử lại sau.';
        } else {
          errorMessage = `❌ Lỗi: ${error.message}`;
        }
      }
      
      const errorChatMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: errorMessage,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorChatMessage]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      setIsLoading(false);
      setInput('');
      setAbortController(null);
    }
  };

  const handleCancel = () => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
      setIsLoading(false);
      setInput('');
      
      const cancelMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: '🚫 Yêu cầu đã được hủy.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, cancelMessage]);
    }
  };
  
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };
  
  return (
    <div className={`fixed bottom-4 left-4 z-50 ${className}`}>
      {/* Chat Button */}
      {!isOpen && (
        <button
          onClick={() => {
            setIsOpen(true);
            setUnreadCount(0);
          }}
          className="relative bg-blue-600 hover:bg-blue-700 text-white rounded-full p-4 shadow-lg transition-all duration-200 hover:scale-110 group"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          
          {/* Tooltip */}
          <div className="absolute bottom-full left-0 mb-2 px-3 py-1 bg-slate-800 text-white text-sm rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
            Hỏi AI về điểm danh
            <div className="absolute top-full left-4 border-4 border-transparent border-t-slate-800"></div>
          </div>
          
          {/* Unread Badge */}
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center animate-pulse">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      )}
      
      {/* Chat Window */}
      {isOpen && (
        <div className="bg-white rounded-lg shadow-2xl w-96 h-[500px] flex flex-col animate-slideUp">
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-3 rounded-t-lg flex justify-between items-center">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <h3 className="font-semibold">🤖 AI Assistant</h3>
            </div>
            <div className="flex items-center space-x-1">
              <button
                onClick={() => {
                  setMessages([]);
                  setUnreadCount(0);
                }}
                className="text-white hover:bg-blue-800 rounded p-1 transition-colors"
                title="Xóa lịch sử"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="text-white hover:bg-blue-800 rounded p-1 transition-colors"
                title="Đóng"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gradient-to-b from-slate-50 to-white">
            {messages.length === 0 && (
              <div className="text-center text-slate-500 text-sm py-8">
                <div className="mb-4">
                  <div className="w-16 h-16 bg-gradient-to-br from-blue-100 to-blue-200 rounded-full flex items-center justify-center mx-auto">
                    🤖
                  </div>
                </div>
                <p className="font-medium text-slate-700">Xin chào! Tôi là trợ lý AI điểm danh</p>
                <p className="text-xs mt-2 text-slate-500">Hỏi tôi về dữ liệu điểm danh bằng tiếng Việt</p>
                <p className="text-xs mt-1 text-slate-400">Ví dụ: "Hôm nay có bao nhiêu sinh viên điểm danh?"</p>
              </div>
            )}
            
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'} animate-fadeIn`}
              >
                <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                  message.type === 'user'
                    ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md'
                    : 'bg-white border border-slate-200 text-slate-900 shadow-sm'
                }`}>
                  <div className="text-sm leading-relaxed">
                    <span dangerouslySetInnerHTML={{ 
                      __html: message.content.replace(
                        /(File:\s*)([^.]+\.xlsx)/gi, 
                        '$1<a href="http://localhost:8000/static/reports/$2" download="$2" style="color: #059669; text-decoration: underline; font-weight: 500;">$2</a>'
                      )
                    }} />
                  </div>
                  {message.fileUrl && message.filename && (
                    <div className="mt-2 pt-2 border-t border-slate-200">
                      <a 
                        href={`http://localhost:8000${message.fileUrl}`}
                        download={message.filename}
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg transition-colors"
                      >
                        📥 Tải báo cáo Excel
                      </a>
                    </div>
                  )}
                  <p className={`text-xs mt-1 ${
                    message.type === 'user' ? 'text-blue-100' : 'text-slate-500'
                  }`}>
                    {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
            
            {isLoading && (
              <div className="flex justify-start animate-fadeIn">
                <div className="bg-white border border-slate-200 rounded-2xl px-4 py-2 shadow-sm">
                  <div className="flex items-center space-x-2">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                      <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                    </div>
                    <button
                      onClick={handleCancel}
                      className="text-xs text-red-600 hover:text-red-700 font-medium ml-2"
                      title="Hủy yêu cầu"
                    >
                      Hủy
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          
          {/* Quick Questions */}
          {messages.length === 0 && (
            <div className="border-t border-slate-200 px-4 py-3 bg-slate-50">
              <p className="text-xs text-slate-600 mb-2 font-medium">Câu hỏi nhanh:</p>
              <div className="flex flex-wrap gap-1">
                {[
                  "Hôm nay có bao nhiêu sinh viên điểm danh?",
                  "Lớp INT3306 có ai đi muộn?",
                  "Sinh viên nào vắng mặt nhiều nhất?",
                  "Tỷ lệ điểm danh tuần này?"
                ].map((question, index) => (
                  <button
                    key={index}
                    onClick={() => setInput(question)}
                    className="text-xs bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-300 px-2 py-1 rounded-full text-slate-700 hover:text-blue-700 transition-all duration-200"
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>
          )}
          
          {/* Input */}
          <div className="border-t border-slate-200 p-3 bg-white">
            <div className="flex space-x-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Nhập câu hỏi về điểm danh..."
                className="flex-1 rounded-full border border-slate-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-20 transition-all"
                disabled={isLoading}
              />
              <button
                onClick={handleSend}
                disabled={isLoading || !input.trim()}
                className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:from-slate-300 disabled:to-slate-400 text-white rounded-full p-2 transition-all duration-200 shadow-md hover:shadow-lg disabled:shadow-none"
              >
                {isLoading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                )}
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-2 text-center">
              💡 Hỗ trợ tiếng Việt • Dữ liệu thời gian thực
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
