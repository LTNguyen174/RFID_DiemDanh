from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime
import logging

from ..ai.services import AIService
from ..auth import get_current_active_user
from ..models import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["AI"])

class ChatRequest(BaseModel):
    question: str
    
class ChatResponse(BaseModel):
    success: bool
    question: Optional[str] = None
    answer: str
    data: Optional[list] = None
    sql: Optional[str] = None
    count: Optional[int] = None
    error: Optional[str] = None

class ReportResponse(BaseModel):
    success: bool
    class_info: Optional[dict] = None
    attendance_data: Optional[list] = None
    report: str
    period: Optional[dict] = None
    total_records: Optional[int] = None
    error: Optional[str] = None


@router.post("/chat", response_model=ChatResponse)
async def chat_with_ai(
    request: ChatRequest,
    current_user: User = Depends(get_current_active_user),
):
    """
    Chatbot truy vấn dữ liệu điểm danh bằng tiếng Việt
    """
    try:
        if not request.question.strip():
            raise HTTPException(status_code=400, detail="Câu hỏi không được để trống")
        
        # Limit question length for safety
        if len(request.question) > 500:
            raise HTTPException(status_code=400, detail="Câu hỏi quá dài, vui lòng dưới 500 ký tự")
        
        logger.info(f"Chat query: {request.question}")
        
        # Initialize AI service with current user for privacy protection
        ai_service_with_user = AIService(current_user=current_user)
        
        # Process with AI service
        result = await ai_service_with_user.chat_query(request.question)
        
        return ChatResponse(**result)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Chat endpoint error: {str(e)}")
        return ChatResponse(
            success=False,
            answer="Đã có lỗi xảy ra khi xử lý câu hỏi của bạn. Vui lòng thử lại."
        )


@router.get("/report/generate/{class_id}", response_model=ReportResponse)
async def generate_class_report(
    class_id: int,
    start_date: date = Query(..., description="Ngày bắt đầu (YYYY-MM-DD)"),
    end_date: date = Query(..., description="Ngày kết thúc (YYYY-MM-DD)"),
    current_user: User = Depends(get_current_active_user),
):
    """
    Tạo báo cáo tự động cho một lớp học trong khoảng thời gian chỉ định
    """
    try:
        # Validate date range
        if start_date > end_date:
            raise HTTPException(status_code=400, detail="Ngày bắt đầu phải trước ngày kết thúc")
        
        # Limit date range to 30 days for performance
        date_diff = (end_date - start_date).days
        if date_diff > 30:
            raise HTTPException(status_code=400, detail="Khoảng thời gian không quá 30 ngày")
        
        logger.info(f"Generating report for class {class_id} from {start_date} to {end_date}")
        
        # Initialize AI service with current user for privacy protection
        ai_service_with_user = AIService(current_user=current_user)
        
        # Generate report with AI
        result = await ai_service_with_user.generate_class_report(class_id, start_date, end_date)
        
        return ReportResponse(**result)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Report generation error: {str(e)}")
        return ReportResponse(
            success=False,
            report=f"Đã có lỗi xảy ra khi tạo báo cáo: {str(e)}"
        )


@router.get("/health")
async def ai_health_check():
    """Health check for AI services"""
    try:
        # Check if AI service is initialized
        if ai_service.llm is None:
            return {"status": "unhealthy", "error": "AI LLM not initialized"}
        
        return {
            "status": "healthy",
            "service": "AI NLP Services",
            "features": ["text-to-sql", "auto-report"],
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"AI health check failed: {str(e)}")
        return {"status": "unhealthy", "error": str(e)}
