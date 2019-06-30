const DetritusRest = require('../lib');

(async () => {
  const client = new DetritusRest.Client();

  try {
    const response = await client.request({
      files: [
        {
          contentType: 'text/plain',
          data: 'file-data-aaaaaaaaaaaaaaaaaa',
          filename: 'file-name.txt',
          name: 'some-field-name',
        },
      ],
      method: 'post',
      url: 'https://nghttp2.org/httpbin/post',
    });
    const body = await response.body();
    console.log(body);
  } catch(error) {
    console.error(error);
  }
})();
