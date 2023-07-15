import type {
	IPollFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	ICredentialDataDecryptedObject,
	IDataObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import moment from 'moment';
import { basename } from 'path';

import ftpClient from 'promise-ftp';
import sftpClient from 'ssh2-sftp-client';

interface FileMapEntry {
	mtime: number;
	type: string;
}

interface ReturnFtpItem {
	type: string;
	name: string;
	size: number;
	accessTime: Date;
	modifyTime: Date;
	rights: {
		user: string;
		group: string;
		other: string;
	};
	owner: string | number;
	group: string | number;
	target: string;
	sticky?: boolean;
	path: string;
}

function normalizeFtpItem(input: ftpClient.ListingElement, path: string, recursive = false) {
	const item = input as unknown as ReturnFtpItem;
	item.modifyTime = input.date;
	item.path = !recursive ? `${path}${path.endsWith('/') ? '' : '/'}${item.name}` : path;
	//@ts-ignore
	delete item.date;
	return item;
}

function normalizeSftpItem(input: sftpClient.FileInfo, path: string, recursive = false) {
	const item = input as unknown as ReturnFtpItem;
	item.accessTime = new Date(input.accessTime);
	item.modifyTime = new Date(input.modifyTime);
	item.path = !recursive ? `${path}${path.endsWith('/') ? '' : '/'}${item.name}` : path;
	return item;
}

export class FtpTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'FTP Trigger',
		name: 'ftpTrigger',
		icon: 'fa:server',
		group: ['trigger'],
		version: 1,
		description: 'Trigger a workflow on FTP or SFTP filesystem changes',
		subtitle: '={{$parameter["protocol"] + ": " + $parameter["event"]}}',
		defaults: {
			name: 'FTP Trigger',
			color: '#303050',
		},
		credentials: [
			{
				// nodelinter-ignore-next-line
				name: 'ftp',
				required: true,
				displayOptions: {
					show: {
						protocol: ['ftp'],
					},
				},
				testedBy: 'ftpConnectionTest',
			},
			{
				// nodelinter-ignore-next-line
				name: 'sftp',
				required: true,
				displayOptions: {
					show: {
						protocol: ['sftp'],
					},
				},
				testedBy: 'sftpConnectionTest',
			},
		],
		polling: true,
		inputs: [],
		outputs: ['main'],
		properties: [
			{
				displayName: 'Protocol',
				name: 'protocol',
				type: 'options',
				options: [
					{
						name: 'FTP',
						value: 'ftp',
					},
					{
						name: 'SFTP',
						value: 'sftp',
					},
				],
				default: 'ftp',
				description: 'File transfer protocol',
			},
			{
				displayName: 'Trigger On',
				name: 'triggerOn',
				type: 'options',
				required: true,
				default: 'specificFolder',
				options: [
					// {
					// 	name: 'Changes to a Specific File',
					// 	value: 'specificFile',
					// },
					{
						name: 'Changes Involving a Specific Folder',
						value: 'specificFolder',
					},
					// {
					// 	name: 'Changes To Any File/Folder',
					// 	value: 'anyFileFolder',
					// },
				],
			},
			{
				displayName: 'File',
				name: 'fileToWatch',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				modes: [
					{
						displayName: 'File',
						name: 'list',
						type: 'list',
						placeholder: 'Select a file...',
						typeOptions: {
							searchListMethod: 'fileSearch',
							searchable: true,
						},
					},
					{
						displayName: 'Path',
						name: 'path',
						type: 'string',
						placeholder: '/etc/hosts'
					},
				],
				displayOptions: {
					show: {
						triggerOn: ['specificFile'],
					},
				},
			},
			{
				displayName: 'Watch For',
				name: 'event',
				type: 'options',
				displayOptions: {
					show: {
						triggerOn: ['specificFile'],
					},
				},
				required: true,
				default: 'fileUpdated',
				options: [
					{
						name: 'File Updated',
						value: 'fileUpdated',
					},
				],
				description: 'When to trigger this node',
			},
			{
				displayName: 'Folder',
				name: 'folderToWatch',
				type: 'resourceLocator',
				default: { mode: 'path', value: '' },
				required: true,
				modes: [
					{
						displayName: 'By Path',
						name: 'path',
						type: 'string',
						placeholder: '/home/user/',
					},
				],
				displayOptions: {
					show: {
						triggerOn: ['specificFolder'],
					},
				},
			},
			{
				displayName: 'Watch For',
				name: 'event',
				type: 'options',
				displayOptions: {
					show: {
						triggerOn: ['specificFolder'],
					},
				},
				required: true,
				default: 'fileCreated',
				options: [
					{
						name: 'File Created',
						value: 'fileCreated',
						description: 'When a file is created in the watched folder',
					},
					{
						name: 'File Deleted',
						value: 'fileDeleted',
						description: 'When a file is deleted in the watched folder',
					},
					{
						name: 'File Updated',
						value: 'fileUpdated',
						description: 'When a file is updated in the watched folder',
					},
					{
						name: 'Folder Created',
						value: 'folderCreated',
						description: 'When a folder is created in the watched folder',
					},
					{
						name: 'Folder Deleted',
						value: 'folderDeleted',
						description: 'When a folder is deleted in the watched folder',
					},
					{
						name: 'Folder Updated',
						value: 'folderUpdated',
						description: 'When a folder is updated in the watched folder',
					},
					{
						name: 'Watch Folder Updated',
						value: 'watchFolderUpdated',
						description: 'When the watched folder itself is modified',
					},
				],
			},
			{
				displayName: "Changes within subfolders won't trigger this node",
				name: 'asas',
				type: 'notice',
				displayOptions: {
					show: {
						triggerOn: ['specificFolder'],
					},
					hide: {
						event: ['watchFolderUpdated'],
					},
				},
				default: '',
			},
			{
				displayName: 'Watch For',
				name: 'event',
				type: 'options',
				displayOptions: {
					show: {
						triggerOn: ['anyFileFolder'],
					},
				},
				required: true,
				default: 'fileCreated',
				options: [
					{
						name: 'File Created',
						value: 'fileCreated',
						description: 'When a file is created in the watched drive',
					},
					{
						name: 'File Updated',
						value: 'fileUpdated',
						description: 'When a file is updated in the watched drive',
					},
					{
						name: 'Folder Created',
						value: 'folderCreated',
						description: 'When a folder is created in the watched drive',
					},
					{
						name: 'Folder Updated',
						value: 'folderUpdated',
						description: 'When a folder is updated in the watched drive',
					},
				],
				description: 'When to trigger this node',
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const triggerOn = this.getNodeParameter('triggerOn') as string;
		const event = this.getNodeParameter('event') as string;
		const isFileEvent = event.startsWith('file');
		const webhookData = this.getWorkflowStaticData('node');
		const now = moment().utc().format();
		let responseData;
		let files: any = [];
		let path: string;
		let credentials: ICredentialDataDecryptedObject | undefined = undefined;
		const protocol = this.getNodeParameter('protocol', 0) as string;

		if (protocol === 'sftp') {
			credentials = await this.getCredentials('sftp');
		} else {
			credentials = await this.getCredentials('ftp');
		}
		let ftp: ftpClient;
		let sftp: sftpClient;

		if (protocol === 'sftp') {
			sftp = new sftpClient();
			await sftp.connect({
			host: credentials.host as string,
				port: credentials.port as number,
				username: credentials.username as string,
				password: credentials.password as string,
				privateKey: credentials.privateKey as string | undefined,
				passphrase: credentials.passphrase as string | undefined,
			});
		} else {
			ftp = new ftpClient();
			await ftp.connect({
				host: credentials.host as string,
				port: credentials.port as number,
				user: credentials.username as string,
				password: credentials.password as string,
			});
		}

		const endDate = now;

		if (triggerOn === 'specificFolder' && event !== 'watchFolderUpdated') {
			path = this.getNodeParameter('folderToWatch', '', { extractValue: true }) as string;
			if (protocol === 'sftp') {
				responseData = await sftp!.list(path);
				await sftp!.end();
			} else {
				responseData = await ftp!.list(path);
				await ftp!.end();
			}
		} else {
			path = this.getNodeParameter('folderToWatch', '', { extractValue: true }) as string;
		}

		files = responseData?.map((item) => protocol === 'sftp'
			? normalizeSftpItem(item as sftpClient.FileInfo, path)
			: normalizeFtpItem(item as ftpClient.ListingElement, path),
		) || [];

		const updatedFileMap = files.reduce((obj: IDataObject, file: ReturnFtpItem) => {
			obj[file.path] = {
				type: file.type,
				mtime: file.modifyTime.getTime(),
			};
			return obj;
		}, {});

		// Compare the state
		const map = (webhookData.fileMap as IDataObject) || {};
		const getModifyTime = (p: string) => (map[p] as FileMapEntry)?.mtime as number | undefined

		const isNewFile = (file: ReturnFtpItem) => {
			const modifyTime = getModifyTime(file.path);
			return modifyTime == undefined;
		};

		const isModifiedFile = (file: ReturnFtpItem) => {
			const modifyTime = getModifyTime(file.path);
			return modifyTime ? modifyTime < file.modifyTime.getTime() : false;
		};

		//console.log(Object.keys(webhookData.fileMap || {}).length, isFileEvent ? 'files' : 'folders' + ' currently tracked');

		if (event === 'fileUpdated' || event === 'folderUpdated') {
			files = files.filter(isModifiedFile);
		} else if (event === 'fileCreated' || event === 'folderCreated') {
			files = files.filter(isNewFile);
		} else if (event === 'fileDeleted' || event === 'folderDeleted') {
			const deletedFiles = [];
			for (const p of Object.keys(map)) {
				if (!p.startsWith(path)) {
					// console.log('skipping file: ', p);
					continue;
				}
				const exists = updatedFileMap.hasOwnProperty(p);
				if (!exists) {
					// console.log('file deleted: ', p);
					deletedFiles.push({
						type: (map[p] as FileMapEntry).type,
						name: basename(p),
						size: 0,
						modifyTime: new Date(),
						accessTime: new Date((map[p] as FileMapEntry).mtime),
						longname: '',
						path: p,
					});
				} else {
					// console.log('file still exists: ', p, 'with modify time', updatedFileMap[p]);
				}
			}
			files = deletedFiles;
		}

		if (isFileEvent) {
			files = files.filter((item: any) => item.type === '-');
		} else {
			files = files.filter((item: any) => item.type === 'd');
		}

		webhookData.fileMap = updatedFileMap;
		webhookData.lastTimeChecked = endDate;

		// console.log(files);

		if (Array.isArray(files) && files.length) {
			return [this.helpers.returnJsonArray(files.map(json => ({ json })))];
		}

		if (this.getMode() === 'manual') {
			throw new NodeApiError(this.getNode(), {
				message: 'No data with the current filter could be found',
			});
		}

		return null;
	}
}
