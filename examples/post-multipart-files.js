const DetritusRest = require('../lib');

(async () => {
  const client = new DetritusRest.Client();

  try {
    const response = await client.request({
      files: [
        {
          contentType: 'text/plain',
          key: 'some-field-name',
          filename: 'file-name.txt',
          value: 'file-data-aaaaaaaaaaaaaaa',
        },
      ],
      method: 'post',
      url: 'https://nghttp2.org/httpbin/post',
    });
    const body = await response.json();
    console.log(body);
  } catch(error) {
    console.error(error);
  }
})();
