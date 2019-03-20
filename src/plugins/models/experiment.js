export default class Experiment {
  type;
  reference;
  name;
  beginTime;
  endTime;
  bench;
  campaign;
  isLocal;

  constructor(reference, name, bench, campaign, isLocal) {
    this.type = 'experiment';
    this.reference = reference;
    this.name = name;
    this.bench = bench;
    this.campaign = campaign;
    this.isLocal = isLocal;
  }

  updateMetadata(metadata) {
    this.beginTime = metadata.beginTime;
    this.endTime = metadata.endTime;
  }
}
