const express = require('express');
const util = require('util');
const moment = require('moment');
const _ = require('lodash');
const router = express.Router();

const { respondJson, respondOnError } = require('../utils/respond');
const { diaryModel } = require('../model');
const { getValue, setStampPosition, getStampPosition } = require('../modules/redisModule');
const { writeFile, deleteFile, createDir, createSaveFileData } = require('../modules/fileModule');
const resultCode = require('../utils/resultCode');
const { parameterFormCheck, getUrl, imagesTypeCheck, getRemainStamp, getRandomStamp } = require('../utils/common');
const { diaryRq } = require('../utils/requestForm');

const controllerName = 'Diary';

router.use((req, res, next) => {

    console.log(util.format('[Logger]::[Controller]::[%sController]::[Access Ip %s]::[Access Time %s]',
                                controllerName,
                                req.ip,
                                moment().tz('Asia/Seoul').format('YYYY-MM-DD HH:mm:ss')
                            ));

    go(
      req.body || req.params || req.query,
      parameterFormCheck,
      f => f(diaryRq[getUrl(req.originalUrl)]),
      result => result
      ? next()
      : respondOnError(res, resultCode.incorrectParamForm, {desc: "incorrect parameter form"})
    );
});

router.post('/write', async (req, res) => {
    const fileName = req.files ? req.files.diaryFile.name : false;
    const { content, location, latitude, longitude } = req.body;
    const data = {
        content: content,
        location: location,
        latitude: latitude,
        longitude: longitude
    };

    const { key, stamp = [] } = await go(
      req.headers['tiptap-token'],
      getValue,
      r => { log(r); return r; },
      obj => obj
      ? obj
      : respondOnError(res, resultCode.error, { desc: 'unknown token' })
    );

    data.user_id = key;

    fileName
    ? go(
        null,
        createDir,
        dir => createSaveFileData(fileName, dir, req.headers['tiptap-token']),
        result => {
            data.imagePath = result.path;
            data.imageUrl = `${baseUrl}/${moment().tz('Asia/Seoul').format('YYYYMMDD')}/${result.name}`;
            req.files.diaryFile.name = result.name;
            return req.files;
        },
        imagesTypeCheck,
        writeFile,
        fileWriteResult => fileWriteResult
        ? true
        : respondOnError(res, resultCode.error, {'desc' : 'file write fail'}),
        _ => diaryModel.create(data).catch(e => respondOnError(res, resultCode.error, e.message)),
        _ => getRemainStamp(stamp),
        getRandomStamp,
        stamp => setStampPosition(req.headers['tiptap-token'], stamp),
        _ => respondJson(res, resultCode.success, { desc: 'completed write diary' })
    )
    : go(
        _ => diaryModel.create(data).catch(e => respondOnError(res, resultCode.error, e.message)),
        _ => getRemainStamp(stamp),
        getRandomStamp,
        stamp => setStampPosition(req.headers['tiptap-token'], stamp),
        _ => respondJson(res, resultCode.success, { desc: 'completed write diary' })
    );
});

router.get('/list', async (req, res) => {
    try {
      const { key, stamp = [] } = await go(
        req.headers['tiptap-token'],
        getValue,
        obj => obj
        ? obj
        : respondOnError(res, resultCode.error, { desc: 'unknown token' })
      );

      let { page = 1 } = req.query;
      const { startDate = '2000-01-01', endDate = '3000-12-31', limit = 3 } = req.query;
      const formatedStartTime = Date.parse(moment(startDate).format());
      const formatedEndTime = Date.parse(moment(endDate).add(1, 'day').format());

      const countOptions = {
        where: {
          createdAt: { gte: formatedStartTime, lt: formatedEndTime }
        }
      };

      page = parseInt(page);

      const SIZE = parseInt(limit); // 한번에 보여줄 글의 수
      const BEGIN = (page - 1) * parseInt(limit); //시작 글
      let totalPage;

      const tableRange = curry((cnt, key) => {
          totalPage = Math.ceil(cnt / SIZE);

          const options = {};
          options.order = [['id', 'DESC']];
          options.where = { createdAt: { gte: formatedStartTime, lt: formatedEndTime }, user_id: key };
          options.offset = BEGIN;
          options.limit = SIZE;
          return options;
      });

      go(
          countOptions,
          options => diaryModel.count(options),
          tableRange,
          f => f(key),
          options => diaryModel.findAll(options).catch(e => respondOnError(res, resultCode.error, e.message)),
          result => respondJson(res, resultCode.success, { list: result, total: totalPage, stamp: stamp })
      );
    } catch (error) {
      respondOnError(res, resultCode.error, error.message);
    }
});

router.get('/today', async (req, res) => {
    try {
      const options = {};
      const { key, stamp = [] } = await go(
        req.headers['tiptap-token'],
        getValue,
        obj => obj
        ? obj
        : respondOnError(res, resultCode.error, { desc: 'unknown token' })
      );

      options.where = { user_id: key };

      go(
        null,
        _ => diaryModel.findToday(options).catch(e => respondOnError(res, resultCode.error, e.message)),
        result => respondJson(res, resultCode.success, { list: result, stamp: stamp })
      );
    } catch (error) {
      respondOnError(res, resultCode.error, error.message);
    }
});

router.post('/update', async (req, res) => {
    try {
      const fileName = req.files ? req.files.diaryFile.name : false;
      const { content, location, latitude, longitude, id } = req.body;
      const options = {
          data: {
              content: content,
              location: location,
              latitude: latitude,
              longitude: longitude
          },
          where: {
              id: id
          }
      };

      const { key } = await go(
        req.headers['tiptap-token'],
        getValue,
        obj => obj
        ? obj
        : respondOnError(res, resultCode.error, { desc: 'unknown token' })
      );

      options.where.user_id = key;

      fileName
      ? go(
          id,
          target => diaryModel.findDeleteTarget({ where: { id: target } }).catch(e => respondOnError(res, resultCode.error, e.message)),
          deleteTarget => deleteFile(deleteTarget.imagePath),
          createDir,
          dir => createSaveFileData(fileName, dir, req.headers['tiptap-token']),
          result => {
              options.data.imagePath = result.path;
              options.data.imageUrl = `${baseUrl}/${moment().tz('Asia/Seoul').format('YYYYMMDD')}/${result.name}`;
              req.files.diaryFile.name = result.name;
              return req.files;
          },
          imagesTypeCheck,
          writeFile,
          fileWriteResult => fileWriteResult
          ? true
          : respondOnError(res, resultCode.error, {'desc' : 'file write fail'}),
          _ => diaryModel.update(options).catch(e => respondOnError(res, resultCode.error, e.message)),
          _ => respondJson(res, resultCode.success, { desc: 'completed update diary' })
      )
      : go(
          _ => diaryModel.update(options).catch(e => respondOnError(res, resultCode.error, e.message)),
          _ => respondJson(res, resultCode.success, { desc: 'completed update diary' })
      );
    } catch (error) {
      respondOnError(res, resultCode.error, error.message);
    }
});

router.post('/delete', (req, res) => {
    try {
      const { id } = req.body;
      const options = {
          where: {
              id: id
          }
      };

      go(
          null,
          _ => diaryModel.delete(options).catch(e => respondOnError(res, resultCode.error, e.message)),
          _ => respondJson(res, resultCode.success, { desc: 'completed delete diary' })
      );
    } catch (error) {
      respondOnError(res, resultCode.error, error.message);
    }
});

module.exports = router;
