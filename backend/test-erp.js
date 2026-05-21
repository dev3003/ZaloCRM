async function test() {
  const apiKey = 'zcrm_5c8dc0d2356951304856879c00fd93d028027b3447453bd7';
  const url = 'https://admin.hostingviet.vn/?hdl=api-crm-zalo/loadAjax';

  try {
    const formData = new FormData();
    formData.append('task', 'checkCustomerPermission');
    formData.append('admin_sale_id', '23052908464277');
    formData.append('admin_customer_id', '23112409422593');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
      },
      body: formData
    });

    const text = await response.text();
    const isJson = text.trim().startsWith('{') || text.trim().startsWith('[');
    
    console.log('Status:', response.status);
    console.log('Is JSON?', isJson);
    if (isJson) {
      console.log('Response body:', text);
    } else {
      console.log('Response (first 200 chars):', text.substring(0, 200));
    }
  } catch(e) {
    console.error('Error:', e.message);
  }
}

test();
