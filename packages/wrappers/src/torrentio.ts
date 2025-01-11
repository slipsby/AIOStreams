import { AddonDetail, ParsedNameData, StreamRequest } from '@aiostreams/types';
import { parseFilename, extractSizeInBytes } from '@aiostreams/parser';
import { ParsedStream, Stream, Config } from '@aiostreams/types';
import { BaseWrapper } from './base';
import { addonDetails, serviceDetails } from '@aiostreams/utils'
import { Settings } from '@aiostreams/utils';

export class Torrentio extends BaseWrapper {
  constructor(
    configString: string | null,
    overrideUrl: string | null,
    indexerTimeout: number = Settings.DEFAULT_TORRENTIO_TIMEOUT,
    addonName: string = 'Torrentio',
    addonId: string
  ) {
    let url = overrideUrl
      ? overrideUrl
      : Settings.TORRENTIO_URL +
        (configString ? configString + '/' : '');

    super(addonName, url, indexerTimeout, addonId);
  }

  protected parseStream(stream: Stream): ParsedStream {
    const filename = stream.title 
      ? stream.title.split('\n')[0] 
      : stream.behaviorHints?.filename?.trim();
  
    const parsedFilename: ParsedNameData = parseFilename(filename || '');
    const sizeInBytes = stream.title
      ? extractSizeInBytes(stream.title, 1024)
      : 0;
    const debridMatch = RegExp(/^\[([a-zA-Z]{2})(\+| download)\]/).exec(
      stream.name!
    );
    const debrid = debridMatch
      ? {
          id: serviceDetails.find((service) => service.knownNames.includes(debridMatch[1]))?.id || debridMatch[1],
          cached: debridMatch[2] === '+',
        }
      : undefined;
    const seedersMatch = RegExp(/👤 (\d+)/).exec(stream.title!);
    const seeders = seedersMatch ? parseInt(seedersMatch[1]) : undefined;

    const indexerMatch = RegExp(/⚙️ (.+)/).exec(stream.title?.split('\n')[1] || '');
    const indexer = indexerMatch ? indexerMatch[1] : undefined;

    const parsedStream: ParsedStream = this.createParsedResult(
      parsedFilename,
      stream,
      filename,
      sizeInBytes,
      debrid,
      seeders,
      undefined,
      indexer
    );
    return parsedStream;
  }
}

export async function getTorrentioStreams(
  config: Config,
  torrentioOptions: {
    useMultipleInstances?: string;
    overrideUrl?: string;
    indexerTimeout?: string;
    overrideName?: string;
  },
  streamRequest: StreamRequest,
  addonId: string
): Promise<ParsedStream[]> {
  const supportedServices: string[] =
    addonDetails.find((addon: AddonDetail) => addon.id === 'torrentio')
      ?.supportedServices || [];
  const parsedStreams: ParsedStream[] = [];
  const indexerTimeout = torrentioOptions.indexerTimeout
    ? parseInt(torrentioOptions.indexerTimeout)
    : undefined;

  // If overrideUrl is provided, use it to get streams and skip all other steps
  if (torrentioOptions.overrideUrl) {
    const torrentio = new Torrentio(
      null,
      torrentioOptions.overrideUrl as string,
      indexerTimeout,
      torrentioOptions.overrideName,
      addonId
    );
    return torrentio.getParsedStreams(streamRequest);
  }

  // find all usable services
  const usableServices = config.services.filter((service) =>
    supportedServices.includes(service.id) && service.enabled
  );

  // if no usable services found, use torrentio without any configuration
  if (usableServices.length < 1) {
    const torrentio = new Torrentio(
      null,
      null,
      indexerTimeout,
      torrentioOptions.overrideName,
      addonId
    );
    return await torrentio.getParsedStreams(streamRequest);
  }

  // otherwise, depending on the configuration, create multiple instances of torrentio or use a single instance with all services

  const getServicePair = (
    serviceId: string,
    credentials: { [key: string]: string }
  ) => {
    return serviceId === 'putio'
      ? `${serviceId}=${credentials.clientId}@${credentials.token}`
      : `${serviceId}=${credentials.apiKey}`;
  };

  if (torrentioOptions.useMultipleInstances === 'true') {
    const promises = usableServices.map(async (service) => {
      if (!service.enabled) {
        return [];
      }
      console.log('Creating Torrentio instance with service:', service.id);
      let configString = getServicePair(service.id, service.credentials);
      const torrentio = new Torrentio(
        configString,
        null,
        indexerTimeout,
        torrentioOptions.overrideName,
        addonId
      );
      return await torrentio.getParsedStreams(streamRequest);
    });
    const results = await Promise.all(promises);
    results.forEach((streams) => parsedStreams.push(...streams));
    return parsedStreams;
  } else {
    let configString = '';
    for (const service of usableServices) {
      if (!service.enabled) {
        continue;
      }
      configString += getServicePair(service.id, service.credentials) + '|';
    }
    const torrentio = new Torrentio(
      configString,
      null,
      indexerTimeout,
      torrentioOptions.overrideName,
      addonId
    );
    return await torrentio.getParsedStreams(streamRequest);
  }
}
