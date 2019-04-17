import * as Influx from 'influx';
import uuidv4 from 'uuid/v4';
import Schema from './schema';
import { dateToTimestamp, timeToTimestamp } from '@/services/date';

const DATABASE_NAME = 'safran_db';

export default class Database {
  _db;
  _host;
  _port;
  _limit;

  /* SUBJECTS */
  _errorsSubject;
  _loadingSubject;
  _experimentSubject;
  _experimentsSubject;
  _benchsSubject;
  _campaignsSubject;
  _measuresSubject;

  constructor(
    errors, loading, experiment, experiments,
    benchs, campaigns, measures
  ) {
    this._host = 'localhost';
    this._port = 8086;
    this._limit = 5;

    this._errorsSubject = errors;
    this._loadingSubject = loading;
    this._experimentSubject = experiment;
    this._experimentsSubject = experiments;
    this._benchsSubject = benchs;
    this._campaignsSubject = campaigns;
    this._measuresSubject = measures;

    this.openDatabase();
    this.install();
  }

  getHost() {
    return this._host + ':' + this._port;
  }

  setHost(host) {
    const split = host.split(':');
    this._host = split[0];
    this._port = split.length > 1 ? split[1] : this._port;
    
    return this.openDatabase();
  }

  getLimit() {
    return this._limit;
  }

  setLimit(limit) {
    this._limit = limit;
  }

  fetchExperiment(id) {
    this._loadingSubject.next(true);
    this._db.query(`SELECT * FROM experiments WHERE "id"=${Influx.escape.stringLit(id)} LIMIT 1;`)
    .then(result => {
      if (result.length < 1) {
        throw new Error('Experiment not found with id ' + id);
      }
      this._experimentSubject.next(result[0]);
    })
    .catch(err => {
      this._errorsSubject.next(err);
      this._experimentSubject.next({});
    })
    .finally(() => {
      this._loadingSubject.next(false);
    });
    return this._experimentSubject;
  }

  fetchExperiments(page = 1) {
    this._loadingSubject.next(true);
    Promise.all([
      this._db.query(`SELECT * FROM experiments LIMIT ${this._limit} OFFSET ${(page - 1) * this._limit};`),
      this._db.query('SELECT count("name") FROM experiments;')
    ])
    .then(values => {
      const result = values[0];
      result.total = values[1].length > 0 ? values[1][0].count / this._limit : 1;
      result.current = page;
      result.limit = this._limit;
      this._experimentsSubject.next(result);
    })
    .catch(err => {
      this._errorsSubject.next(err);
      this._experimentsSubject.next([]);
    })
    .finally(() => {
      this._loadingSubject.next(false);
    });
    return this._experimentsSubject;
  }

  fetchBenchs() {
    this._loadingSubject.next(true);
    this._db.query('SELECT DISTINCT(bench) FROM experiments;')
    .then(result => {
      this._benchsSubject.next(result.map(r => JSON.parse(r.distinct)));
    })
    .catch(err => {
      this._errorsSubject.next(err);
      this._benchsSubject.next([]);
    })
    .finally(() => {
      this._loadingSubject.next(false);
    });
    return this._benchsSubject;
  }

  fetchCampaigns() {
    this._loadingSubject.next(true);
    this._db.query('SELECT DISTINCT(campaign) FROM experiments;')
    .then(result => {
      this._campaignsSubject.next(result.map(r => JSON.parse(r.distinct)));
    })
    .catch(err => {
      this._errorsSubject.next(err);
      this._campaignsSubject.next([]);
    })
    .finally(() => {
      this._loadingSubject.next(false);
    });
    return this._campaignsSubject;
  }

  fetchMeasure(id) {
    this._loadingSubject.next(true);
    return this._db.query(`SELECT * FROM measures WHERE "id"=${Influx.escape.stringLit(id)} LIMIT 1;`)
    .then(result => {
      if (result.length < 1) {
        throw new Error('Experiment not found with id ' + id);
      }
      return result[0];
    })
    .catch(err => {
      this._errorsSubject.next(err);
      throw err;
    })
    .finally(() => {
      this._loadingSubject.next(false);
    });
  }

  fetchMeasures(experimentId, page = 1) {
    this._loadingSubject.next(true);
    Promise.all([
      this._db.query(
        `SELECT * FROM measures
        WHERE "experimentId"=${Influx.escape.stringLit(experimentId)}
        LIMIT ${this._limit}
        OFFSET ${(page - 1) * this._limit};`
      ),
      this._db.query(`SELECT count("name") FROM measures WHERE "experimentId"=${Influx.escape.stringLit(experimentId)};`)
    ])
    .then(values => {
      const result = values[0];
      result.total = values[1].length > 0 ? values[1][0].count / this._limit : 1;
      result.current = page;
      result.limit = this._limit;
      this._measuresSubject.next(result);
    })
    .catch(err => {
      this._errorsSubject.next(err);
      this._measuresSubject.next([]);
    })
    .finally(() => {
      this._loadingSubject.next(false);
    });
    return this._measuresSubject;
  }

  fetchSamples(measureId) {
    this._loadingSubject.next(true);
    return this._db.query(
      `SELECT * FROM samples WHERE "measureId"=${Influx.escape.stringLit(measureId)};`,
      { precision: Influx.Precision.Milliseconds }
    )
    .catch(err => {
      this._errorsSubject.next(err);
      throw err;
    })
    .finally(() => {
      this._loadingSubject.next(false);
    });
  }

  fetchAlarms(experimentId) {
    this._loadingSubject.next(true);
    return this._db.query(
      `SELECT * FROM alarms WHERE "experimentId"=${Influx.escape.stringLit(experimentId)};`,
      { precision: Influx.Precision.Milliseconds }
    )
    .catch(err => {
      this._errorsSubject.next(err);
      throw err;
    })
    .finally(() => {
      this._loadingSubject.next(false);
    });
  }

  insertExperiment(experiment) {
    this._loadingSubject.next(true);
    const points = [{
      measurement: 'experiments',
      tags: { id: uuidv4() },
      fields: {
        reference: experiment.reference,
        name: experiment.name,
        bench: JSON.stringify(experiment.bench),
        campaign: JSON.stringify(experiment.campaign),
        isLocal: experiment.isLocal,
        beginTime: dateToTimestamp(experiment.beginTime),
        endTime: dateToTimestamp(experiment.endTime)
      }
    }];

    return this._db.writePoints(points)
    .then(() => {
      return points[0].tags.id;
    })
    .catch(err => {
      this._errorsSubject.next(err);
      throw err;
    })
    .finally(() => {
      this._loadingSubject.next(false);
    });
  }

  insertMeasures(experimentId, measures) {
    this._loadingSubject.next(true);
    const points = measures.map(measure => ({
      measurement: 'measures',
      tags: { id: uuidv4(), experimentId },
      fields: {
        name: measure.name,
        type: measure.type,
        unit: measure.unit
      }
    }));

    return this._db.writePoints(points)
    .then(() => {
      return points.map(point => point.tags.id);
    })
    .catch(err => {
      this._errorsSubject.next(err);
      throw err;
    })
    .finally(() => {
      this._loadingSubject.next(false);
    });
  }

  insertSamples(experimentId, samples, date = new Date()) {
    this._loadingSubject.next(true);
    const points = samples.map(sample => ({
      measurement: 'samples',
      tags: { experimentId, measureId: sample.measure },
      fields: {
        value: sample.value,
      },
      timestamp: timeToTimestamp(sample.time, date)
    }));

    return this._db.writePoints(points, { precision: Influx.Precision.Milliseconds })
    .catch(err => {
      this._errorsSubject.next(err);
      throw err;
    })
    .finally(() => {
      this._loadingSubject.next(false);
    });
  }

  insertAlarms(experimentId, alarms, date = new Date()) {
    this._loadingSubject.next(true);
    const points = alarms.map(alarm => ({
      measurement: 'alarms',
      tags: { experimentId },
      fields: {
        level: alarm.level,
        message: alarm.message
      },
      timestamp: timeToTimestamp(alarm.time, date)
    }));

    return this._db.writePoints(points, { precision: Influx.Precision.Milliseconds })
    .catch(err => {
      this._errorsSubject.next(err);
      throw err;
    })
    .finally(() => {
      this._loadingSubject.next(false);
    });
  }

  removeExperiment(id) {
    this._loadingSubject.next(true);
    return Promise.all([
      this._db.query(`DELETE FROM experiments WHERE "id"=${Influx.escape.stringLit(id)};`),
      this._db.query(`DELETE FROM measures WHERE "experimentId"=${Influx.escape.stringLit(id)};`),
      this._db.query(`DELETE FROM samples WHERE "experimentId"=${Influx.escape.stringLit(id)};`),
      this._db.query(`DELETE FROM alarms WHERE "experimentId"=${Influx.escape.stringLit(id)};`)
    ])
    .catch(err => {
      this._errorsSubject.next(err);
      throw err;
    })
    .finally(() => {
      this._loadingSubject.next(false);
    });
  }

  async changes() {
    return {
      local: [],
      remote: [],
      length: 0
    };
  }

  openDatabase() {
    this._loadingSubject.next(true);
    this._db = new Influx.InfluxDB({
      host: this._host,
      port: this._port,
      database: DATABASE_NAME,
      schema: Schema
    });

    return this._db.ping(5000)
    .then(hosts => {
      const hasSucceed = hosts.every(host => host.online);
      if (!hasSucceed) {
        throw new Error('Host not online : ' + this._host + ':' + this._port);
      }
    })
    .catch(err => {
      this._errorsSubject.next(err);
      throw err;
    })
    .finally(() => {
      this._loadingSubject.next(false);
    });
  }

  install() {
    this._loadingSubject.next(true);
    return this._db.getDatabaseNames()
    .then(names => {
      if (!names.includes(DATABASE_NAME)) {
        return this._db.createDatabase(DATABASE_NAME);
      }
    })
    .catch(err => {
      this._errorsSubject.next(err);
      throw err;
    })
    .finally(() => {
      this._loadingSubject.next(false);
    });
  }

  drop() {
    this._loadingSubject.next(true);
    return this._db.dropDatabase(DATABASE_NAME)
    .catch(err => {
      this._errorsSubject.next(err);
      throw err;
    })
    .finally(() => {
      this._loadingSubject.next(false);
    });
  }
}
