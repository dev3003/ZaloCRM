$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0

try {
    $doc = $word.Documents.Open('C:\laragon\www\omni360.vn\MODULE_GIAO_DUC_WITH_MARKETING.doc', $false, $false)

    $text = "

15.7 TÍCH HỢP HỆ THỐNG ZALO CRM (GỬI THÔNG BÁO HÀNG LOẠT MIỄN PHÍ)
"
    $text += "Hệ thống Zalo CRM cho phép kết nối tài khoản Zalo cá nhân của nhân viên (Zalo Sale) với CRM để tự động hóa việc chăm sóc khách hàng mà không tốn chi phí.
"
    $text += "• Chi phí: 0đ (Miễn phí 100% so với 350đ/tin của ZNS).
"
    $text += "• Tính năng nổi bật:
"
    $text += "  - Gửi thông báo hàng loạt: Khai giảng, lịch học, nhắc đóng học phí, ưu đãi sự kiện.
"
    $text += "  - Cá nhân hóa tin nhắn: Tự động thay tên khách hàng, tên khóa học, số tiền (Ví dụ: Chào {ten}, nhắc phí khóa {khoa_hoc}...).
"
    $text += "  - Cơ chế chống Spam: Tự động phân bổ luồng gửi qua nhiều tài khoản Zalo khác nhau với thời gian giãn cách an toàn.
"
    $text += "  - Báo cáo trực quan: Thống kê chính xác tỷ lệ gửi thành công, thất bại và tỷ lệ phản hồi (rep rate) của chiến dịch.
"

    $range = $doc.Content
    $range.Collapse(0) # 0 = wdCollapseEnd
    $range.InsertAfter($text)

    $doc.Save()
    $doc.Close()
    Write-Host "Success"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
} finally {
    $word.Quit()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null
}
