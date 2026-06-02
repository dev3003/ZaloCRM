$word = New-Object -ComObject Word.Application
$word.Visible = $false
$doc = $word.Documents.Open('C:\laragon\www\omni360.vn\MODULE_GIAO_DUC_WITH_MARKETING.doc')
$selection = $word.Selection

# Di chuyển đến cuối file
$wdStory = 6
$selection.EndKey($wdStory) | Out-Null
$selection.TypeParagraph()
$selection.TypeParagraph()

# Đổi style thành Heading (tùy chọn) hoặc in đậm
$selection.Font.Bold = $true
$selection.Font.Size = 14
$selection.TypeText('15.7 TÍCH HỢP HỆ THỐNG ZALO CRM (GỬI THÔNG BÁO HÀNG LOẠT MIỄN PHÍ)')
$selection.TypeParagraph()

$selection.Font.Bold = $false
$selection.Font.Size = 12
$selection.TypeText('Hệ thống Zalo CRM cho phép kết nối tài khoản Zalo cá nhân của nhân viên (Zalo Sale) với CRM để tự động hóa việc chăm sóc khách hàng mà không tốn chi phí.')
$selection.TypeParagraph()
$selection.TypeText('• Chi phí: 0đ (Miễn phí 100% so với 350đ/tin của ZNS).')
$selection.TypeParagraph()
$selection.TypeText('• Tính năng nổi bật:')
$selection.TypeParagraph()
$selection.TypeText('  - Gửi thông báo hàng loạt: Khai giảng, lịch học, nhắc đóng học phí, ưu đãi sự kiện.')
$selection.TypeParagraph()
$selection.TypeText('  - Cá nhân hóa tin nhắn: Tự động thay tên khách hàng, tên khóa học, số tiền (Ví dụ: Chào {ten}, nhắc phí khóa {khoa_hoc}...).')
$selection.TypeParagraph()
$selection.TypeText('  - Cơ chế chống Spam: Tự động phân bổ luồng gửi qua nhiều tài khoản Zalo khác nhau với thời gian giãn cách an toàn.')
$selection.TypeParagraph()
$selection.TypeText('  - Báo cáo trực quan: Thống kê chính xác tỷ lệ gửi thành công, thất bại và tỷ lệ phản hồi (rep rate) của chiến dịch.')
$selection.TypeParagraph()

$doc.Save()
$doc.Close()
$word.Quit()
